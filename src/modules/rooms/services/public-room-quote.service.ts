import { eq, inArray } from "drizzle-orm";
import type { Database } from "../../../plugins/database.js";
import { experienceVariants } from "../../../db/schema/experience_variants.schema.js";
import { experiences } from "../../../db/schema/experiences.schema.js";
import {
  bookingDateJakarta,
  priceRoomNights,
} from "../../reservations/services/reservations-campaigns.service.js";
import {
  readRoomAvailability,
  stayDates,
} from "../../reservations/services/reservations-availability.service.js";
import { calculateReservationTotal } from "../../reservations/services/reservation-total.service.js";
import type { PublicRoomQuoteBody } from "../schemas/public-room-quote.schema.js";

export class PublicRoomQuoteError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function quotePublicRooms(db: Database | Transaction, body: PublicRoomQuoteBody) {
  const {
    checkInDate,
    checkOutDate,
    rooms,
    promoCode,
    experiences: selectedExperiences = [],
  } = body;
  const today = bookingDateJakarta();
  const dates = stayDates(checkInDate, checkOutDate);
  if (!dates || checkInDate < today) {
    throw new PublicRoomQuoteError(
      "INVALID_STAY_DATES",
      "Use dates from today for a stay of 1 to 366 nights",
    );
  }
  if ((body.totalAdults === undefined) !== (body.totalChildren === undefined)) {
    throw new PublicRoomQuoteError(
      "INVALID_GUEST_COUNT",
      "Provide both totalAdults and totalChildren",
    );
  }
  const adults = rooms.reduce((sum, room) => sum + room.adults, 0);
  const children = rooms.reduce((sum, room) => sum + room.children, 0);
  if (adults === 0) {
    throw new PublicRoomQuoteError("INVALID_GUEST_COUNT", "At least one adult is required");
  }
  if (
    (body.totalAdults !== undefined && body.totalAdults !== adults) ||
    (body.totalChildren !== undefined && body.totalChildren !== children)
  ) {
    throw new PublicRoomQuoteError(
      "GUEST_ALLOCATION_MISMATCH",
      "Guest totals must match the selected rooms",
    );
  }

  const requested = new Map<string, number>();
  for (const room of rooms) {
    requested.set(room.roomTypeId, (requested.get(room.roomTypeId) ?? 0) + 1);
  }
  const options = await readRoomAvailability(db, checkInDate, checkOutDate, dates, [
    ...requested.keys(),
  ]);
  const byType = new Map(options.map((option) => [option.roomType.id, option]));
  for (const [roomTypeId, quantity] of requested) {
    const option = byType.get(roomTypeId);
    if (!option) {
      throw new PublicRoomQuoteError(
        "ROOM_UNAVAILABLE",
        `Room type ${roomTypeId} is unavailable`,
        409,
      );
    }
    if (option.availableRooms < quantity) {
      throw new PublicRoomQuoteError(
        "ROOM_UNAVAILABLE",
        `Only ${option.availableRooms} rooms remain for room type ${roomTypeId}; ${quantity} requested`,
        409,
      );
    }
    if (checkInDate === today && option.assignableRoomUnits.length < quantity) {
      throw new PublicRoomQuoteError(
        "ROOM_UNAVAILABLE",
        `Only ${option.assignableRoomUnits.length} ready rooms remain for room type ${roomTypeId} today; ${quantity} requested`,
        409,
      );
    }
    if (!option.bookable) {
      throw new PublicRoomQuoteError(
        "ROOM_UNAVAILABLE",
        `Room type ${roomTypeId} is unavailable: ${option.unavailableReasons.join(", ")}`,
        409,
      );
    }
  }
  for (const [roomIndex, room] of rooms.entries()) {
    const option = byType.get(room.roomTypeId)!;
    if (
      !option.capacityPatterns.some(
        (pattern) =>
          pattern.adults === room.adults &&
          pattern.children === room.children &&
          pattern.extraBeds <= (room.extraBeds ?? 0),
      )
    ) {
      throw new PublicRoomQuoteError(
        "INVALID_CAPACITY",
        `Room ${roomIndex + 1}: guest count or extra beds are not allowed for this room type`,
      );
    }
  }
  for (const item of selectedExperiences) {
    if (item.serviceDate && (item.serviceDate < checkInDate || item.serviceDate >= checkOutDate)) {
      throw new PublicRoomQuoteError(
        "INVALID_SERVICE_DATE",
        "Experience date must fall within the stay",
      );
    }
  }

  const selectedVariants = selectedExperiences.length
    ? await db
        .select({ variant: experienceVariants, experience: experiences })
        .from(experienceVariants)
        .innerJoin(experiences, eq(experienceVariants.experienceId, experiences.id))
        .where(
          inArray(
            experienceVariants.id,
            selectedExperiences.map((item) => item.variantId),
          ),
        )
    : [];
  for (const item of selectedExperiences) {
    const selected = selectedVariants.find(
      (row) => row.variant.id === item.variantId && row.experience.isActive,
    );
    if (!selected || item.quantity > selected.experience.maxQuantity) {
      throw new PublicRoomQuoteError(
        "INVALID_EXPERIENCE",
        "Experience variant is unavailable or exceeds its quantity limit",
      );
    }
  }

  const priced = await priceRoomNights(db, {
    source: "website",
    promoCode,
    bookingDate: today,
    nights: dates.length,
    roomCount: rooms.length,
    rows: rooms.flatMap((room, roomIndex) =>
      byType.get(room.roomTypeId)!.nightlyRates.map((night) => ({
        roomIndex,
        roomTypeId: room.roomTypeId,
        stayDate: night.stayDate,
        basePrice: night.basePrice!,
      })),
    ),
  });
  const charges = calculateReservationTotal({
    rooms,
    roomRates: new Map(options.map((option) => [option.roomType.id, option.roomType])),
    roomNights: priced.rows,
    nights: dates.length,
    experiences: selectedExperiences,
    experienceRates: new Map(
      selectedVariants.map((row) => [
        row.variant.id,
        { name: `${row.experience.name} · ${row.variant.subName}`, unitPrice: row.variant.price },
      ]),
    ),
  });
  const baseRoomTotal = priced.rows.reduce((sum, row) => sum + row.basePrice, 0);
  return {
    checkInDate,
    checkOutDate,
    nights: dates.length,
    roomCount: rooms.length,
    guests: { adults, children },
    rooms: charges.rooms.map((room) => ({
      ...room,
      roomTypeName: byType.get(room.roomTypeId)!.roomType.name,
      adults: rooms[room.roomIndex].adults,
      children: rooms[room.roomIndex].children,
      baseAmount: priced.rows
        .filter((row) => row.roomIndex === room.roomIndex)
        .reduce((sum, row) => sum + row.basePrice, 0),
      discountAmount: priced.rows
        .filter((row) => row.roomIndex === room.roomIndex)
        .reduce((sum, row) => sum + row.discountAmount, 0),
    })),
    nightlyRates: priced.rows.map(
      ({
        roomIndex,
        roomTypeId,
        stayDate,
        basePrice,
        discountAmount,
        finalPrice,
        campaignId,
        campaignSnapshot,
      }) => ({
        roomIndex,
        roomTypeId,
        stayDate,
        basePrice,
        discountAmount,
        finalPrice,
        campaignId,
        campaignSnapshot,
      }),
    ),
    appliedCampaigns: priced.appliedCampaigns,
    promoCodeSnapshot: priced.promoCodeSnapshot,
    experiences: charges.experiences,
    baseRoomTotal,
    discountTotal: priced.discountTotal,
    roomTotal: charges.roomTotal,
    extraBedTotal: charges.extraBedTotal,
    breakfastTotal: charges.breakfastTotal,
    experienceTotal: charges.experienceTotal,
    bookingTotal: charges.bookingTotal,
    currency: "IDR",
  };
}
