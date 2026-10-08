import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import type { Database } from "../../../plugins/database.js";
import { cancellationPolicies } from "../../../db/schema/cancellation_policies.schema.js";
import { cancellationPolicyRoomTypes } from "../../../db/schema/cancellation_policy_room_types.schema.js";
import { cancellationRules } from "../../../db/schema/cancellation_rules.schema.js";
import { masterItems } from "../../../db/schema/master_items.schema.js";
import {
  bookingDateJakarta,
  priceRoomNights,
} from "../../reservations/services/reservations-campaigns.service.js";
import {
  readRoomAvailability,
  stayDates,
} from "../../reservations/services/reservations-availability.service.js";
import { listPublicRooms } from "./public-rooms.service.js";

export type PublicRoomAvailabilityQuery = {
  checkInDate: string;
  checkOutDate: string;
  roomTypeId?: string;
  rooms?: number;
  adults?: number;
  children?: number;
};

function fitsGuestGroup(
  patterns: { adults: number; children: number; extraBeds: number }[],
  roomCount: number,
  adults: number,
  children: number,
) {
  let possible = new Set(["0:0"]);
  for (let room = 0; room < roomCount; room += 1) {
    const next = new Set<string>();
    for (const key of possible) {
      const [usedAdults, usedChildren] = key.split(":").map(Number);
      for (const pattern of patterns) {
        const totalAdults = usedAdults + pattern.adults;
        const totalChildren = usedChildren + pattern.children;
        if (totalAdults <= adults && totalChildren <= children) {
          next.add(`${totalAdults}:${totalChildren}`);
        }
      }
    }
    possible = next;
    if (!possible.size) return false;
  }
  return possible.has(`${adults}:${children}`);
}

async function websiteCancellationPolicies(
  db: Database,
  checkInDate: string,
  lastStayDate: string,
) {
  const policies = await db
    .select()
    .from(cancellationPolicies)
    .where(
      and(
        eq(cancellationPolicies.isActive, true),
        eq(cancellationPolicies.appliesWebsite, true),
        or(
          isNull(cancellationPolicies.stayStart),
          lte(cancellationPolicies.stayStart, checkInDate),
        ),
        or(isNull(cancellationPolicies.stayEnd), gte(cancellationPolicies.stayEnd, lastStayDate)),
      ),
    )
    .orderBy(desc(cancellationPolicies.createdAt), asc(cancellationPolicies.name));
  if (!policies.length) return [];
  const ids = policies.map((policy) => policy.id);
  const [links, rules, types] = await Promise.all([
    db
      .select()
      .from(cancellationPolicyRoomTypes)
      .where(inArray(cancellationPolicyRoomTypes.policyId, ids)),
    db
      .select()
      .from(cancellationRules)
      .where(inArray(cancellationRules.policyId, ids))
      .orderBy(asc(cancellationRules.sortOrder)),
    db
      .select({ id: masterItems.id, name: masterItems.name })
      .from(masterItems)
      .where(
        inArray(
          masterItems.id,
          policies.map((policy) => policy.policyTypeId).filter((id): id is string => Boolean(id)),
        ),
      ),
  ]);
  const typeNames = new Map(types.map((type) => [type.id, type.name]));
  return policies.map((policy) => ({
    id: policy.id,
    name: policy.name,
    policyType: policy.policyTypeId ? (typeNames.get(policy.policyTypeId) ?? null) : null,
    noShowChargeType: policy.noShowChargeType,
    noShowChargeValue: policy.noShowChargeValue,
    stayStart: policy.stayStart,
    stayEnd: policy.stayEnd,
    roomTypeIds: links.filter((link) => link.policyId === policy.id).map((link) => link.roomTypeId),
    rules: rules
      .filter((rule) => rule.policyId === policy.id)
      .map((rule) => ({
        timingType: rule.timingType,
        daysBefore: rule.daysBefore,
        chargeType: rule.chargeType,
        chargeValue: rule.chargeValue,
      })),
  }));
}

export async function searchPublicRoomAvailability(
  db: Database,
  query: PublicRoomAvailabilityQuery,
) {
  const dates = stayDates(query.checkInDate, query.checkOutDate);
  if (!dates || query.checkInDate < bookingDateJakarta()) {
    throw new Error("INVALID_STAY_DATES");
  }
  if ((query.adults === undefined) !== (query.children === undefined)) {
    throw new Error("INVALID_GUEST_COUNT");
  }

  const roomCount = query.rooms ?? 1;
  const [catalog, availability, policies] = await Promise.all([
    listPublicRooms(db),
    readRoomAvailability(
      db,
      query.checkInDate,
      query.checkOutDate,
      dates,
      query.roomTypeId ? [query.roomTypeId] : undefined,
    ),
    websiteCancellationPolicies(db, query.checkInDate, dates[dates.length - 1]),
  ]);
  const catalogById = new Map(catalog.map((room) => [room.id, room]));

  const items = await Promise.all(
    availability.map(async (option) => {
      const room = catalogById.get(option.roomType.id);
      const reasons = [...option.unavailableReasons];
    if (option.availableRooms < roomCount && !reasons.includes("insufficient_rooms")) {
      reasons.push("insufficient_rooms");
    }
    if (
      query.checkInDate === bookingDateJakarta() &&
      option.assignableRoomUnits.length < roomCount &&
      !reasons.includes("no_ready_room")
    ) {
      reasons.push("insufficient_ready_rooms");
    }
      const guestCapacityFit =
        query.adults === undefined || query.children === undefined
          ? null
          : fitsGuestGroup(option.capacityPatterns, roomCount, query.adults, query.children);
      if (guestCapacityFit === false) reasons.push("capacity_mismatch");

      const configured = option.nightlyRates.every((rate) => rate.basePrice !== null);
      const priced = configured
        ? await priceRoomNights(db, {
            source: "website",
            bookingDate: bookingDateJakarta(),
            nights: dates.length,
            roomCount,
            rows: Array.from({ length: roomCount }, (_, roomIndex) =>
              option.nightlyRates.map((rate) => ({
                roomIndex,
                roomTypeId: option.roomType.id,
                stayDate: rate.stayDate,
                basePrice: rate.basePrice!,
              })),
            ).flat(),
          })
        : null;

      const applicablePolicies = policies.filter(
        (policy) =>
          policy.roomTypeIds.includes(option.roomType.id),
      );
      return {
        roomType: room ?? option.roomType,
        physicalRooms: option.physicalRooms,
        availableRooms: option.availableRooms,
        requestedRooms: roomCount,
        guestCapacityFit,
        bookable: reasons.length === 0,
        unavailableReasons: reasons,
        nightlyRates: option.nightlyRates,
        pricePreview: priced
          ? {
              roomTotal: priced.roomTotal,
              discountTotal: priced.discountTotal,
              nightly: priced.rows.map(
                ({ roomIndex, stayDate, basePrice, discountAmount, finalPrice, campaignId }) => ({
                  roomIndex,
                  stayDate,
                  basePrice,
                  discountAmount,
                  finalPrice,
                  campaignId,
                }),
              ),
              appliedCampaigns: priced.appliedCampaigns,
            }
          : null,
        cancellationPolicies: applicablePolicies.length
          ? applicablePolicies.map(({ roomTypeIds: _roomTypeIds, ...policy }) => policy)
          : [
              {
                id: null,
                name: "100% cancellation charge",
                policyType: "Non-refundable",
                noShowChargeType: null,
                noShowChargeValue: 0,
                stayStart: null,
                stayEnd: null,
                rules: [
                  {
                    timingType: "within",
                    daysBefore: 0,
                    chargeType: "percentage",
                    chargeValue: 100,
                  },
                ],
              },
            ],
      };
    }),
  );

  return {
    checkInDate: query.checkInDate,
    checkOutDate: query.checkOutDate,
    nights: dates.length,
    rooms: roomCount,
    adults: query.adults ?? null,
    children: query.children ?? null,
    items,
  };
}
