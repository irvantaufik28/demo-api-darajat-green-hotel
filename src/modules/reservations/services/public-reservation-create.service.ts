import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Database } from "../../../plugins/database.js";
import { cancellationPolicies } from "../../../db/schema/cancellation_policies.schema.js";
import { cancellationPolicyRoomTypes } from "../../../db/schema/cancellation_policy_room_types.schema.js";
import { cancellationRules } from "../../../db/schema/cancellation_rules.schema.js";
import { experienceVariants } from "../../../db/schema/experience_variants.schema.js";
import { experiences } from "../../../db/schema/experiences.schema.js";
import { guests } from "../../../db/schema/guests.schema.js";
import { reservationCharges } from "../../../db/schema/reservation_charges.schema.js";
import { reservationExperiences } from "../../../db/schema/reservation_experiences.schema.js";
import { reservationRoomExtraBeds } from "../../../db/schema/reservation_room_extra_beds.schema.js";
import { reservationRoomNights } from "../../../db/schema/reservation_room_nights.schema.js";
import { reservationRooms } from "../../../db/schema/reservation_rooms.schema.js";
import { reservationSettings } from "../../../db/schema/reservation_settings.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { roomInventoryDaily } from "../../../db/schema/room_inventory_daily.schema.js";
import { quotePublicRooms } from "../../rooms/services/public-room-quote.service.js";
import { requestHash } from "../reservation-idempotency.js";
import type { PublicReservationCreateBody } from "../schemas/public-reservation-create.schema.js";
import { recordReservationEvent } from "./reservation-events.service.js";
import { bookingDateJakarta, InvalidPromoCodeError } from "./reservations-campaigns.service.js";
import { stayDates } from "./reservations-availability.service.js";
import { ReservationTotalError } from "./reservation-total.service.js";
import { PublicRoomQuoteError } from "../../rooms/services/public-room-quote.service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class PublicReservationCreateError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

const noRefundPolicy = {
  name: "100% cancellation charge",
  type: "non_refundable",
  chargeType: "percentage",
  chargeValue: 100,
} as const;

async function roomCancellationPolicies(
  tx: Transaction,
  body: PublicReservationCreateBody,
  lastStayDate: string,
  quote: Awaited<ReturnType<typeof quotePublicRooms>>,
) {
  const policies = await tx
    .select()
    .from(cancellationPolicies)
    .where(
      and(
        eq(cancellationPolicies.isActive, true),
        eq(cancellationPolicies.appliesWebsite, true),
        or(
          isNull(cancellationPolicies.stayStart),
          lte(cancellationPolicies.stayStart, body.checkInDate),
        ),
        or(isNull(cancellationPolicies.stayEnd), gte(cancellationPolicies.stayEnd, lastStayDate)),
      ),
    );
  const ids = policies.map((policy) => policy.id);
  const [links, rules] = ids.length
    ? await Promise.all([
        tx
          .select()
          .from(cancellationPolicyRoomTypes)
          .where(inArray(cancellationPolicyRoomTypes.policyId, ids)),
        tx.select().from(cancellationRules).where(inArray(cancellationRules.policyId, ids)),
      ])
    : [[], []];
  return body.rooms.map((room, roomIndex) => {
    const eligible = policies.filter((policy) => {
      const assigned = links.filter((link) => link.policyId === policy.id);
      return assigned.length === 0 || assigned.some((link) => link.roomTypeId === room.roomTypeId);
    });
    const campaignIds = new Set(
      quote.nightlyRates
        .filter((night) => night.roomIndex === roomIndex && night.campaignId)
        .map((night) => night.campaignId),
    );
    const campaignPolicyIds = [
      ...new Set(
        quote.appliedCampaigns
          .filter((campaign) => campaignIds.has(campaign.id) && campaign.cancellationPolicyId)
          .map((campaign) => campaign.cancellationPolicyId!),
      ),
    ];
    if (campaignPolicyIds.length > 1) {
      throw new PublicReservationCreateError(
        "POLICY_SELECTION_REQUIRED",
        `Room ${roomIndex + 1} has conflicting campaign cancellation policies`,
        409,
      );
    }
    const selectedId =
      room.cancellationPolicyId ??
      campaignPolicyIds[0] ??
      (eligible.length === 1 ? eligible[0].id : null);
    if (!selectedId && eligible.length > 1) {
      throw new PublicReservationCreateError(
        "POLICY_SELECTION_REQUIRED",
        `Choose a cancellation policy for room ${roomIndex + 1}`,
        409,
      );
    }
    const selected = eligible.find((policy) => policy.id === selectedId);
    if (selectedId && !selected) {
      throw new PublicReservationCreateError(
        "INVALID_POLICY",
        `Cancellation policy is unavailable for room ${roomIndex + 1}`,
      );
    }
    return {
      roomIndex,
      roomTypeId: room.roomTypeId,
      policyId: selected?.id ?? null,
      snapshot: selected
        ? { policy: selected, rules: rules.filter((rule) => rule.policyId === selected.id) }
        : noRefundPolicy,
    };
  });
}

export async function createPublicReservation(db: Database, body: PublicReservationCreateBody) {
  const idempotencyKey = body.idempotencyKey.trim();
  const guest = {
    fullName: body.guest.fullName.trim(),
    phone: body.guest.phone.trim(),
    email: body.guest.email.trim().toLowerCase(),
    nationality: body.guest.nationality?.trim() || null,
  };
  if (!guest.fullName || !guest.phone || !guest.email) {
    throw new PublicReservationCreateError(
      "INVALID_GUEST",
      "Guest name, phone, and email are required",
    );
  }
  const dates = stayDates(body.checkInDate, body.checkOutDate);
  if (!dates || body.checkInDate < bookingDateJakarta()) {
    throw new PublicReservationCreateError(
      "INVALID_STAY_DATES",
      "Use dates from today for a stay of 1 to 366 nights",
    );
  }
  const hash = requestHash(body);
  const roomTypeIds = [...new Set(body.rooms.map((room) => room.roomTypeId))].sort();

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`reservation-create:${idempotencyKey}`}))`,
    );
    const [existing] = await tx
      .select({
        hash: reservations.idempotencyRequestHash,
        snapshot: reservations.createResponseSnapshot,
      })
      .from(reservations)
      .where(eq(reservations.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existing) {
      if (existing.hash !== hash) {
        throw new PublicReservationCreateError(
          "IDEMPOTENCY_KEY_REUSED",
          "Idempotency key was used for a different booking",
          409,
        );
      }
      return { reservation: existing.snapshot, replayed: true };
    }
    for (const roomTypeId of roomTypeIds) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${roomTypeId}))`);
    }
    await tx
      .select({ id: roomInventoryDaily.id })
      .from(roomInventoryDaily)
      .where(
        and(
          inArray(roomInventoryDaily.roomTypeId, roomTypeIds),
          gte(roomInventoryDaily.stayDate, dates[0]),
          lte(roomInventoryDaily.stayDate, dates[dates.length - 1]),
        ),
      )
      .for("update");
    const quote = await quotePublicRooms(tx, body);
    const policies = await roomCancellationPolicies(tx, body, dates[dates.length - 1], quote);
    const [settings] = await tx
      .select({ expiryMinutes: reservationSettings.websitePaymentExpiryMinutes })
      .from(reservationSettings)
      .limit(1);
    const expiryMinutes = settings?.expiryMinutes ?? 30;
    const now = new Date();
    const paymentExpiresAt = new Date(now.getTime() + expiryMinutes * 60_000);
    const [createdGuest] = await tx.insert(guests).values(guest).returning({ id: guests.id });
    const id = randomUUID();
    const bookingCode = `GH-${id.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    await tx.insert(reservations).values({
      id,
      bookingCode,
      idempotencyKey,
      idempotencyRequestHash: hash,
      guestId: createdGuest.id,
      source: "website",
      checkInDate: body.checkInDate,
      checkOutDate: body.checkOutDate,
      adults: quote.guests.adults,
      children: quote.guests.children,
      reservationStatus: "pending",
      paymentStatus: "unpaid",
      paymentExpiresAt,
      promoCodeSnapshot: quote.promoCodeSnapshot,
      cancellationPolicySnapshot: { type: "per_room", rooms: [] },
      specialRequests: body.specialRequests?.trim() || null,
    });

    const roomPolicySnapshots = [];
    for (const [roomIndex, room] of body.rooms.entries()) {
      const quotedRoom = quote.rooms[roomIndex];
      const [createdRoom] = await tx
        .insert(reservationRooms)
        .values({
          reservationId: id,
          roomTypeId: room.roomTypeId,
          roomTypeNameSnapshot: quotedRoom.roomTypeName,
          adults: room.adults,
          children: room.children,
        })
        .returning({ id: reservationRooms.id });
      const nights = quote.nightlyRates.filter((night) => night.roomIndex === roomIndex);
      await tx.insert(reservationRoomNights).values(
        nights.map((night) => ({
          reservationRoomId: createdRoom.id,
          stayDate: night.stayDate,
          basePrice: night.basePrice,
          discountAmount: night.discountAmount,
          finalPrice: night.finalPrice,
          campaignSnapshot: night.campaignSnapshot,
        })),
      );
      await tx.insert(reservationCharges).values({
        reservationId: id,
        reservationRoomId: createdRoom.id,
        kind: "room",
        description: `${quotedRoom.roomTypeName} · ${dates.length} night(s)`,
        quantity: "1",
        unitAmount: quotedRoom.roomAmount,
        amount: quotedRoom.roomAmount,
      });
      if (quotedRoom.extraBeds) {
        await tx.insert(reservationRoomExtraBeds).values({
          reservationRoomId: createdRoom.id,
          quantity: quotedRoom.extraBeds,
          dateFrom: body.checkInDate,
          dateTo: body.checkOutDate,
          unitPricePerNight: quotedRoom.extraBedUnitPricePerNight,
        });
        await tx.insert(reservationCharges).values({
          reservationId: id,
          reservationRoomId: createdRoom.id,
          kind: "extra_bed",
          description: `Extra bed · ${quotedRoom.roomTypeName}`,
          quantity: String(quotedRoom.extraBeds * dates.length),
          unitAmount: quotedRoom.extraBedUnitPricePerNight,
          amount: quotedRoom.extraBedAmount,
        });
      }
      for (const [label, quantity, unitAmount, amount] of [
        [
          "Adult breakfast",
          quotedRoom.adultBreakfasts,
          quotedRoom.adultBreakfastUnitPrice,
          quotedRoom.adultBreakfastAmount,
        ],
        [
          "Child breakfast",
          quotedRoom.childBreakfasts,
          quotedRoom.childBreakfastUnitPrice,
          quotedRoom.childBreakfastAmount,
        ],
      ] as const) {
        if (!quantity) continue;
        await tx.insert(reservationCharges).values({
          reservationId: id,
          reservationRoomId: createdRoom.id,
          kind: "breakfast",
          description: `${label} · ${quotedRoom.roomTypeName}`,
          quantity: String(quantity * dates.length),
          unitAmount,
          amount,
        });
      }
      roomPolicySnapshots.push({
        ...policies[roomIndex],
        reservationRoomId: createdRoom.id,
      });
    }
    await tx
      .update(reservations)
      .set({
        cancellationPolicySnapshot: { type: "per_room", rooms: roomPolicySnapshots },
      })
      .where(eq(reservations.id, id));

    const variantIds = (body.experiences ?? []).map((item) => item.variantId);
    const variants = variantIds.length
      ? await tx
          .select({ variant: experienceVariants, experience: experiences })
          .from(experienceVariants)
          .innerJoin(experiences, eq(experienceVariants.experienceId, experiences.id))
          .where(inArray(experienceVariants.id, variantIds))
      : [];
    for (const item of body.experiences ?? []) {
      const row = variants.find((candidate) => candidate.variant.id === item.variantId)!;
      const name = `${row.experience.name} · ${row.variant.subName}`;
      await tx.insert(reservationExperiences).values({
        reservationId: id,
        experienceId: row.experience.id,
        nameSnapshot: name.slice(0, 160),
        descriptionSnapshot: row.variant.description,
        quantity: item.quantity,
        unitPrice: row.variant.price,
        serviceDate: item.serviceDate ?? null,
      });
      await tx.insert(reservationCharges).values({
        reservationId: id,
        kind: "experience",
        sourceId: item.variantId,
        description: name,
        quantity: String(item.quantity),
        unitAmount: row.variant.price,
        amount: row.variant.price * item.quantity,
        serviceDate: item.serviceDate ?? null,
      });
    }

    await recordReservationEvent(tx, {
      reservationId: id,
      eventType: "reservation.created",
      actorType: "system",
      reservationStatusAfter: "pending",
      paymentStatusAfter: "unpaid",
      details: {
        bookingCode,
        source: "website",
        bookingTotal: quote.bookingTotal,
        roomCount: body.rooms.length,
        paymentExpiresAt: paymentExpiresAt.toISOString(),
        expiryMinutes,
      },
    });
    const result = {
      id,
      bookingCode,
      reservationStatus: "pending" as const,
      paymentStatus: "unpaid" as const,
      paymentExpiresAt: paymentExpiresAt.toISOString(),
      expiryMinutes,
      bookingTotal: quote.bookingTotal,
      currency: "IDR" as const,
    };
    await tx
      .update(reservations)
      .set({ createResponseSnapshot: result })
      .where(eq(reservations.id, id));
    return { reservation: result, replayed: false };
  });
}

export { InvalidPromoCodeError, PublicRoomQuoteError, ReservationTotalError };
