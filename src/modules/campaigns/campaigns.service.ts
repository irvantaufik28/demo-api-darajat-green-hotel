import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../../plugins/database.js";
import { campaignBlackoutDates } from "../../db/schema/campaign_blackout_dates.schema.js";
import { campaignDays } from "../../db/schema/campaign_days.schema.js";
import { campaignRoomTypes } from "../../db/schema/campaign_room_types.schema.js";
import { campaignSources } from "../../db/schema/campaign_sources.schema.js";
import { campaigns } from "../../db/schema/campaigns.schema.js";
import { cancellationPolicies } from "../../db/schema/cancellation_policies.schema.js";
import { roomTypes } from "../../db/schema/room_types.schema.js";
import type { CampaignBody } from "./campaigns.schemas.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class CampaignInputError extends Error {}

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function validateCampaign(db: Database, body: CampaignBody) {
  if (!body.name.trim()) throw new CampaignInputError("Campaign name is required");
  if (body.requiresCode && !body.promoCode?.trim()) {
    throw new CampaignInputError("Promo code is required when requiresCode is true");
  }
  if (body.discountType === "percent" && body.discountValue > 100) {
    throw new CampaignInputError("Discount percentage cannot exceed 100");
  }
  for (const value of [body.bookingStart, body.bookingEnd, body.stayStart, body.stayEnd]) {
    if (value && !validDate(value)) throw new CampaignInputError("Invalid campaign date");
  }
  if (body.bookingStart && body.bookingEnd && body.bookingEnd < body.bookingStart) {
    throw new CampaignInputError("Booking end must be on or after booking start");
  }
  if (body.stayStart && body.stayEnd && body.stayEnd < body.stayStart) {
    throw new CampaignInputError("Stay end must be on or after stay start");
  }
  for (const blackout of body.blackoutDates) {
    if (
      !validDate(blackout.dateFrom) ||
      !validDate(blackout.dateTo) ||
      blackout.dateTo < blackout.dateFrom
    ) {
      throw new CampaignInputError("Invalid blackout date range");
    }
  }
  if (
    new Set(body.sources).size !== body.sources.length ||
    new Set(body.weekdays).size !== body.weekdays.length
  ) {
    throw new CampaignInputError("Sources and weekdays must be unique");
  }
  if (body.cancellationPolicyId) {
    const [policy] = await db
      .select({ id: cancellationPolicies.id })
      .from(cancellationPolicies)
      .where(
        and(
          eq(cancellationPolicies.id, body.cancellationPolicyId),
          eq(cancellationPolicies.isActive, true),
        ),
      )
      .limit(1);
    if (!policy) throw new CampaignInputError("Cancellation policy not found or inactive");
  }
  if (body.roomTypeIds.length) {
    const found = await db
      .select({ id: roomTypes.id })
      .from(roomTypes)
      .where(inArray(roomTypes.id, body.roomTypeIds));
    if (found.length !== body.roomTypeIds.length)
      throw new CampaignInputError("One or more room types were not found");
  }
}

export function campaignValues(body: CampaignBody) {
  return {
    name: body.name.trim(),
    promoCode: body.promoCode?.trim().toUpperCase() || null,
    requiresCode: body.requiresCode,
    bookingStart: body.bookingStart ?? null,
    bookingEnd: body.bookingEnd ?? null,
    stayStart: body.stayStart ?? null,
    stayEnd: body.stayEnd ?? null,
    discountType: body.discountType,
    discountValue: body.discountValue,
    minNights: body.minNights,
    minRooms: body.minRooms,
    priority: body.priority,
    cancellationPolicyId: body.cancellationPolicyId ?? null,
    isActive: body.isActive,
  };
}

export async function replaceCampaignRelations(
  tx: Transaction,
  campaignId: string,
  body: CampaignBody,
) {
  await tx.delete(campaignBlackoutDates).where(eq(campaignBlackoutDates.campaignId, campaignId));
  await tx.delete(campaignDays).where(eq(campaignDays.campaignId, campaignId));
  await tx.delete(campaignSources).where(eq(campaignSources.campaignId, campaignId));
  await tx.delete(campaignRoomTypes).where(eq(campaignRoomTypes.campaignId, campaignId));

  await tx.insert(campaignDays).values(body.weekdays.map((weekday) => ({ campaignId, weekday })));
  await tx.insert(campaignSources).values(body.sources.map((source) => ({ campaignId, source })));
  if (body.roomTypeIds.length) {
    await tx
      .insert(campaignRoomTypes)
      .values(body.roomTypeIds.map((roomTypeId) => ({ campaignId, roomTypeId })));
  }
  if (body.blackoutDates.length) {
    await tx.insert(campaignBlackoutDates).values(
      body.blackoutDates.map((item) => ({
        campaignId,
        dateFrom: item.dateFrom,
        dateTo: item.dateTo,
        label: item.label?.trim() || null,
      })),
    );
  }
}

export async function getCampaignDetail(db: Database, id: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!campaign) return null;
  const [sources, weekdays, roomTypesList, blackoutDates] = await Promise.all([
    db
      .select({ source: campaignSources.source })
      .from(campaignSources)
      .where(eq(campaignSources.campaignId, id)),
    db
      .select({ weekday: campaignDays.weekday })
      .from(campaignDays)
      .where(eq(campaignDays.campaignId, id))
      .orderBy(asc(campaignDays.weekday)),
    db
      .select({ id: roomTypes.id, code: roomTypes.code, name: roomTypes.name })
      .from(campaignRoomTypes)
      .innerJoin(roomTypes, eq(campaignRoomTypes.roomTypeId, roomTypes.id))
      .where(eq(campaignRoomTypes.campaignId, id))
      .orderBy(asc(roomTypes.name)),
    db
      .select()
      .from(campaignBlackoutDates)
      .where(eq(campaignBlackoutDates.campaignId, id))
      .orderBy(asc(campaignBlackoutDates.dateFrom)),
  ]);
  return {
    ...campaign,
    sources: sources.map((item) => item.source),
    weekdays: weekdays.map((item) => item.weekday),
    roomTypes: roomTypesList,
    blackoutDates,
  };
}
