import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../../../plugins/database.js";
import { experienceVariants } from "../../../db/schema/experience_variants.schema.js";
import { experiences } from "../../../db/schema/experiences.schema.js";
import { masterItems } from "../../../db/schema/master_items.schema.js";
import { roomTypes } from "../../../db/schema/room_types.schema.js";
import { bookingDateJakarta } from "../../reservations/services/reservations-campaigns.service.js";
import { stayDates } from "../../reservations/services/reservations-availability.service.js";
import type { PublicBookingExtrasQuery } from "../schemas/public-booking-extras.schema.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PublicBookingExtrasError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export async function listPublicBookingExtras(db: Database, query: PublicBookingExtrasQuery) {
  const dates = stayDates(query.checkInDate, query.checkOutDate);
  if (!dates || query.checkInDate < bookingDateJakarta()) {
    throw new PublicBookingExtrasError(
      "INVALID_STAY_DATES",
      "Use dates from today for a stay of 1 to 366 nights",
      400,
    );
  }

  const roomTypeIds = [...new Set(query.roomTypeIds.split(",").map((id) => id.trim()))];
  if (roomTypeIds.length < 1 || roomTypeIds.length > 20 || roomTypeIds.some((id) => !uuidPattern.test(id))) {
    throw new PublicBookingExtrasError(
      "INVALID_ROOM_TYPES",
      "Provide 1 to 20 comma-separated room type IDs",
      400,
    );
  }

  const [rooms, experienceRows] = await Promise.all([
    db
      .select({
        id: roomTypes.id,
        name: roomTypes.name,
        extraBedEnabled: roomTypes.extraBedEnabled,
        maxExtraBeds: roomTypes.maxExtraBeds,
        extraBedPricePerNight: roomTypes.extraBedPricePerNight,
        adultBreakfastPrice: roomTypes.adultBreakfastPrice,
        childBreakfastPrice: roomTypes.childBreakfastPrice,
      })
      .from(roomTypes)
      .where(and(inArray(roomTypes.id, roomTypeIds), eq(roomTypes.isActive, true))),
    db
      .select({
        id: experiences.id,
        code: experiences.code,
        slug: experiences.slug,
        name: experiences.name,
        description: experiences.description,
        imageUrl: experiences.imageUrl,
        maxQuantity: experiences.maxQuantity,
        categoryId: masterItems.id,
        categoryCode: masterItems.code,
        categoryName: masterItems.name,
        categorySortOrder: masterItems.sortOrder,
      })
      .from(experiences)
      .innerJoin(masterItems, eq(experiences.categoryId, masterItems.id))
      .where(and(
        eq(experiences.isActive, true),
        eq(masterItems.isActive, true),
        eq(masterItems.category, "experience_categories"),
      ))
      .orderBy(asc(masterItems.sortOrder), asc(experiences.name)),
  ]);

  if (rooms.length !== roomTypeIds.length) {
    throw new PublicBookingExtrasError(
      "ROOM_TYPE_NOT_FOUND",
      "One or more room types are unavailable",
      404,
    );
  }

  const variants = experienceRows.length
    ? await db
        .select({
          id: experienceVariants.id,
          experienceId: experienceVariants.experienceId,
          name: experienceVariants.subName,
          description: experienceVariants.description,
          price: experienceVariants.price,
        })
        .from(experienceVariants)
        .where(inArray(experienceVariants.experienceId, experienceRows.map((row) => row.id)))
        .orderBy(asc(experienceVariants.sortOrder), asc(experienceVariants.subName))
    : [];

  const roomById = new Map(rooms.map((room) => [room.id, room]));
  return {
    checkInDate: query.checkInDate,
    checkOutDate: query.checkOutDate,
    nights: dates.length,
    rooms: roomTypeIds.map((roomTypeId) => {
      const room = roomById.get(roomTypeId)!;
      return {
        roomTypeId: room.id,
        roomTypeName: room.name,
        addOns: [
          ...(room.extraBedEnabled && room.maxExtraBeds > 0
            ? [{ code: "extra_bed", price: room.extraBedPricePerNight, unit: "per_night", maxQuantityPerRoom: room.maxExtraBeds }]
            : []),
          { code: "adult_breakfast", price: room.adultBreakfastPrice, unit: "per_person_per_night", maxQuantityPerRoom: null },
          { code: "child_breakfast", price: room.childBreakfastPrice, unit: "per_person_per_night", maxQuantityPerRoom: null },
        ],
      };
    }),
    experiences: experienceRows.flatMap((experience) => {
      const options = variants.filter((variant) => variant.experienceId === experience.id)
        .map(({ experienceId: _experienceId, ...variant }) => variant);
      return options.length > 0 ? [{
        id: experience.id,
        code: experience.code,
        slug: experience.slug,
        name: experience.name,
        description: experience.description,
        imageUrl: experience.imageUrl,
        maxQuantity: experience.maxQuantity,
        category: {
          id: experience.categoryId,
          code: experience.categoryCode,
          name: experience.categoryName,
        },
        variants: options,
      }] : [];
    }),
    requests: [
      { code: "baby_cot", priceType: "on_request" },
      { code: "extra_person", priceType: "on_request" },
      { code: "early_check_in", priceType: "on_request" },
      { code: "late_check_out", priceType: "on_request" },
    ],
  };
}
