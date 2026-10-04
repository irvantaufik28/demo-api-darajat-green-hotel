import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../../../plugins/database.js";
import { campaignBlackoutDates } from "../../../db/schema/campaign_blackout_dates.schema.js";
import { campaignDays } from "../../../db/schema/campaign_days.schema.js";
import { campaignRoomTypes } from "../../../db/schema/campaign_room_types.schema.js";
import { campaigns } from "../../../db/schema/campaigns.schema.js";
import type { ReservationCampaignSnapshot } from "../../../db/schema/reservation_room_nights.schema.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryDatabase = Database | Transaction;

export type PricedRoomNight = {
  roomIndex: number;
  roomTypeId: string;
  stayDate: string;
  basePrice: number;
  discountAmount: number;
  finalPrice: number;
  campaignId: string | null;
  campaignSnapshot: ReservationCampaignSnapshot | null;
};

export class InvalidPromoCodeError extends Error {}

async function loadCampaignCatalog(db: QueryDatabase) {
  const campaignRows = await db
    .select()
    .from(campaigns)
    .where(
      and(eq(campaigns.isActive, true), inArray(campaigns.discountType, ["percent", "fixed"])),
    );
  campaignRows.sort(
    (a, b) =>
      a.priority - b.priority ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  const ids = campaignRows.map((campaign) => campaign.id);
  const [roomTypes, weekdays, blackouts] = ids.length
    ? await Promise.all([
        db.select().from(campaignRoomTypes).where(inArray(campaignRoomTypes.campaignId, ids)),
        db.select().from(campaignDays).where(inArray(campaignDays.campaignId, ids)),
        db
          .select()
          .from(campaignBlackoutDates)
          .where(inArray(campaignBlackoutDates.campaignId, ids)),
      ])
    : [[], [], []];
  return { campaignRows, roomTypes, weekdays, blackouts };
}

type CampaignCatalog = Awaited<ReturnType<typeof loadCampaignCatalog>>;

function applicableCampaign(
  catalog: CampaignCatalog,
  input: {
    source: "website" | "phone" | "walk_in" | "ota";
    bookingDate: string;
    stayDate: string;
    roomTypeId: string;
    nights: number;
    roomCount: number;
    code: string | null;
    preview?: boolean;
  },
) {
  const weekday = new Date(`${input.stayDate}T00:00:00.000Z`).getUTCDay() || 7;
  return catalog.campaignRows.find((campaign) => {
    if (
      (campaign.bookingStart && campaign.bookingStart > input.bookingDate) ||
      (campaign.bookingEnd && campaign.bookingEnd < input.bookingDate) ||
      (campaign.stayStart && campaign.stayStart > input.stayDate) ||
      (campaign.stayEnd && campaign.stayEnd < input.stayDate) ||
      (!input.preview && campaign.minNights > input.nights) ||
      (!input.preview && campaign.minRooms > input.roomCount) ||
      (!input.preview && campaign.requiresCode && campaign.promoCode !== input.code)
    ) {
      return false;
    }
    if (
      input.source === "ota" ||
      campaign.channel !== (input.source === "website" ? "website" : "front_desk")
    ) {
      return false;
    }
    const applicableRooms = catalog.roomTypes.filter((room) => room.campaignId === campaign.id);
    return (
      (applicableRooms.length === 0 ||
        applicableRooms.some((room) => room.roomTypeId === input.roomTypeId)) &&
      catalog.weekdays.some((day) => day.campaignId === campaign.id && day.weekday === weekday) &&
      !catalog.blackouts.some(
        (blackout) =>
          blackout.campaignId === campaign.id &&
          blackout.dateFrom <= input.stayDate &&
          blackout.dateTo >= input.stayDate,
      )
    );
  });
}

export function bookingDateJakarta(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export async function priceRoomNights(
  db: QueryDatabase,
  input: {
    source: "website" | "phone" | "walk_in" | "ota";
    promoCode?: string | null;
    bookingDate: string;
    nights: number;
    roomCount: number;
    rows: { roomIndex: number; roomTypeId: string; stayDate: string; basePrice: number }[];
  },
) {
  const code = input.promoCode?.trim().toUpperCase() || null;
  const catalog = await loadCampaignCatalog(db);

  const pricedRows: PricedRoomNight[] = input.rows.map((row) => {
    const campaign = applicableCampaign(catalog, {
      source: input.source,
      bookingDate: input.bookingDate,
      stayDate: row.stayDate,
      roomTypeId: row.roomTypeId,
      nights: input.nights,
      roomCount: input.roomCount,
      code,
    });
    const discountAmount =
      campaign?.discountType === "percent"
        ? Math.min(row.basePrice, Math.floor((row.basePrice * campaign.discountValue) / 100))
        : 0;
    return {
      ...row,
      discountAmount,
      finalPrice: row.basePrice - discountAmount,
      campaignId: campaign?.id ?? null,
      campaignSnapshot: campaign
        ? {
            id: campaign.id,
            name: campaign.name,
            promoCode: campaign.promoCode,
            channel: campaign.channel,
            discountType: campaign.discountType,
            discountValue: campaign.discountValue,
            priority: campaign.priority,
            bookingStart: campaign.bookingStart,
            bookingEnd: campaign.bookingEnd,
            stayStart: campaign.stayStart,
            stayEnd: campaign.stayEnd,
          }
        : null,
    };
  });

  for (const campaign of catalog.campaignRows.filter((item) => item.discountType === "fixed")) {
    const matches = pricedRows.filter((row) => row.campaignId === campaign.id);
    const totalBase = matches.reduce((sum, row) => sum + row.basePrice, 0);
    if (!totalBase) continue;
    const discount = Math.min(campaign.discountValue, totalBase);
    let distributed = 0;
    for (const row of matches) {
      row.discountAmount = Number((BigInt(discount) * BigInt(row.basePrice)) / BigInt(totalBase));
      distributed += row.discountAmount;
    }
    let remainder = discount - distributed;
    for (const row of matches) {
      if (!remainder) break;
      if (row.discountAmount < row.basePrice) {
        row.discountAmount += 1;
        remainder -= 1;
      }
    }
    for (const row of matches) row.finalPrice = row.basePrice - row.discountAmount;
  }

  const appliedCampaignIds = [
    ...new Set(pricedRows.map((row) => row.campaignId).filter((id): id is string => Boolean(id))),
  ];
  if (
    code &&
    !catalog.campaignRows.some(
      (campaign) => campaign.promoCode === code && appliedCampaignIds.includes(campaign.id),
    )
  ) {
    throw new InvalidPromoCodeError("Promo code is not valid for the selected stay");
  }
  return {
    rows: pricedRows,
    discountTotal: pricedRows.reduce((sum, row) => sum + row.discountAmount, 0),
    roomTotal: pricedRows.reduce((sum, row) => sum + row.finalPrice, 0),
    appliedCampaignIds,
    promoCodeSnapshot: code,
    appliedCampaigns: catalog.campaignRows
      .filter((campaign) => appliedCampaignIds.includes(campaign.id))
      .map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        bookingEnd: campaign.bookingEnd,
        stayEnd: campaign.stayEnd,
        priority: campaign.priority,
        cancellationPolicyId: campaign.cancellationPolicyId,
      })),
  };
}

export async function previewDailyCampaignPrices(
  db: QueryDatabase,
  input: {
    bookingDate: string;
    roomTypeId: string;
    rows: { stayDate: string; basePrice: number | null }[];
  },
) {
  const catalog = await loadCampaignCatalog(db);
  return input.rows.map((row) => {
    const forSource = (source: "website" | "walk_in") => {
      if (row.basePrice === null) return { promo: null, price: null };
      const campaign = applicableCampaign(catalog, {
        source,
        bookingDate: input.bookingDate,
        stayDate: row.stayDate,
        roomTypeId: input.roomTypeId,
        nights: 1,
        roomCount: 1,
        code: null,
        preview: true,
      });
      if (!campaign) return { promo: null, price: null };
      const promo = {
        id: campaign.id,
        name: campaign.name,
        promoCode: campaign.promoCode,
        requiresCode: campaign.requiresCode,
        discountType: campaign.discountType,
        discountValue: campaign.discountValue,
        minNights: campaign.minNights,
        minRooms: campaign.minRooms,
        priority: campaign.priority,
      };
      const price =
        campaign.discountType === "percent"
          ? row.basePrice -
            Math.min(row.basePrice, Math.floor((row.basePrice * campaign.discountValue) / 100))
          : campaign.minNights === 1 && campaign.minRooms === 1
            ? Math.max(0, row.basePrice - campaign.discountValue)
            : null;
      return { promo, price };
    };
    return {
      stayDate: row.stayDate,
      website: forSource("website"),
      frontDesk: forSource("walk_in"),
    };
  });
}
