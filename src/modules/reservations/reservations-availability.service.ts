import { and, count, eq, gt, gte, inArray, lt, lte, notInArray } from "drizzle-orm";
import type { Database } from "../../plugins/database.js";
import { capacityPatterns } from "../../db/schema/capacity_patterns.schema.js";
import { reservations } from "../../db/schema/reservations.schema.js";
import { reservationRooms } from "../../db/schema/reservation_rooms.schema.js";
import { roomInventoryDaily } from "../../db/schema/room_inventory_daily.schema.js";
import { roomTypeCapacityPatterns } from "../../db/schema/room_type_capacity_patterns.schema.js";
import { roomTypes } from "../../db/schema/room_types.schema.js";
import { roomUnits } from "../../db/schema/room_units.schema.js";
import { bookingDateJakarta } from "./reservations-campaigns.service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryDatabase = Database | Transaction;

export function stayDates(checkInDate: string, checkOutDate: string): string[] | null {
  const start = new Date(`${checkInDate}T00:00:00.000Z`);
  const end = new Date(`${checkOutDate}T00:00:00.000Z`);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start.toISOString().slice(0, 10) !== checkInDate ||
    end.toISOString().slice(0, 10) !== checkOutDate ||
    end <= start
  ) {
    return null;
  }
  const nights = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (nights > 366) return null;
  return Array.from({ length: nights }, (_, index) =>
    new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10),
  );
}

export async function readRoomAvailability(
  db: QueryDatabase,
  checkInDate: string,
  checkOutDate: string,
  dates: string[],
  requestedRoomTypeIds?: string[],
  guests?: { adults: number; children: number },
) {
  const roomTypeFilter = requestedRoomTypeIds?.length
    ? inArray(roomTypes.id, requestedRoomTypeIds)
    : undefined;
  const types = await db
    .select({
      id: roomTypes.id,
      code: roomTypes.code,
      name: roomTypes.name,
      extraBedEnabled: roomTypes.extraBedEnabled,
      maxExtraBeds: roomTypes.maxExtraBeds,
      extraBedPricePerNight: roomTypes.extraBedPricePerNight,
      adultBreakfastPrice: roomTypes.adultBreakfastPrice,
      childBreakfastPrice: roomTypes.childBreakfastPrice,
    })
    .from(roomTypes)
    .where(and(eq(roomTypes.isActive, true), roomTypeFilter));
  if (!types.length) return [];
  const ids = types.map((type) => type.id);
  const requiresReadyRoom = checkInDate <= bookingDateJakarta();

  const capacities = guests
    ? await db
        .select({
          roomTypeId: roomTypeCapacityPatterns.roomTypeId,
          extraBeds: roomTypeCapacityPatterns.extraBeds,
        })
        .from(roomTypeCapacityPatterns)
        .innerJoin(
          capacityPatterns,
          eq(roomTypeCapacityPatterns.capacityPatternId, capacityPatterns.id),
        )
        .where(
          and(
            inArray(roomTypeCapacityPatterns.roomTypeId, ids),
            eq(capacityPatterns.isActive, true),
            eq(capacityPatterns.adults, guests.adults),
            eq(capacityPatterns.children, guests.children),
          ),
        )
    : [];

  const [inventory, unitCounts, bookings] = await Promise.all([
    db
      .select()
      .from(roomInventoryDaily)
      .where(
        and(
          inArray(roomInventoryDaily.roomTypeId, ids),
          gte(roomInventoryDaily.stayDate, dates[0]),
          lte(roomInventoryDaily.stayDate, dates[dates.length - 1]),
        ),
      ),
    db
      .select({ roomTypeId: roomUnits.roomTypeId, total: count() })
      .from(roomUnits)
      .where(
        and(
          inArray(roomUnits.roomTypeId, ids),
          eq(roomUnits.isActive, true),
          notInArray(roomUnits.operationalStatus, ["maintenance", "out_of_service"]),
        ),
      )
      .groupBy(roomUnits.roomTypeId),
    db
      .select({
        roomTypeId: reservationRooms.roomTypeId,
        roomUnitId: reservationRooms.roomUnitId,
        checkInDate: reservations.checkInDate,
        checkOutDate: reservations.checkOutDate,
      })
      .from(reservationRooms)
      .innerJoin(reservations, eq(reservationRooms.reservationId, reservations.id))
      .where(
        and(
          inArray(reservationRooms.roomTypeId, ids),
          inArray(reservations.reservationStatus, ["pending", "confirmed", "checked_in"]),
          lt(reservations.checkInDate, checkOutDate),
          gt(reservations.checkOutDate, checkInDate),
        ),
      ),
  ]);

  const assignableUnits = await db
    .select({
      id: roomUnits.id,
      roomTypeId: roomUnits.roomTypeId,
      roomNumber: roomUnits.roomNumber,
      bedConfiguration: roomUnits.bedConfiguration,
      operationalStatus: roomUnits.operationalStatus,
    })
    .from(roomUnits)
    .where(
      and(
        inArray(roomUnits.roomTypeId, ids),
        eq(roomUnits.isActive, true),
        notInArray(roomUnits.operationalStatus, ["maintenance", "out_of_service"]),
      ),
    );

  const inventoryByKey = new Map(
    inventory.map((row) => [`${row.roomTypeId}:${row.stayDate}`, row]),
  );
  const unitsByType = new Map(unitCounts.map((row) => [row.roomTypeId, row.total]));

  return types.map((type) => {
    const assignedDuringStay = new Set(
      bookings
        .filter((booking) => booking.roomTypeId === type.id)
        .map((booking) => booking.roomUnitId),
    );
    const roomUnitsForAssignment = assignableUnits
      .filter(
        (unit) =>
          unit.roomTypeId === type.id &&
          !assignedDuringStay.has(unit.id) &&
          (!requiresReadyRoom || unit.operationalStatus === "available"),
      )
      .map((unit) => ({
        id: unit.id,
        roomNumber: unit.roomNumber,
        bedConfiguration: unit.bedConfiguration,
        operationalStatus: unit.operationalStatus,
      }));
    const matchingBeds = capacities
      .filter(
        (capacity) =>
          capacity.roomTypeId === type.id &&
          capacity.extraBeds <= type.maxExtraBeds &&
          (capacity.extraBeds === 0 || type.extraBedEnabled),
      )
      .map((capacity) => capacity.extraBeds);
    const requiredExtraBeds = guests
      ? matchingBeds.length
        ? Math.min(...matchingBeds)
        : null
      : null;
    const physicalRooms = unitsByType.get(type.id) ?? 0;
    let totalPrice = 0;
    let availableRooms = physicalRooms;
    const reasons = new Set<string>();
    if (guests && requiredExtraBeds === null) reasons.add("capacity_mismatch");
    const nightlyRates = dates.map((date) => {
      const configured = inventoryByKey.get(`${type.id}:${date}`);
      const occupied = bookings.filter(
        (booking) =>
          booking.roomTypeId === type.id &&
          booking.checkInDate <= date &&
          booking.checkOutDate > date,
      ).length;
      if (!configured) {
        reasons.add("not_configured");
        availableRooms = 0;
        return { stayDate: date, basePrice: null, sellableStock: null, occupied, available: 0 };
      }
      totalPrice += configured.basePrice;
      const available = Math.max(0, Math.min(configured.sellableStock, physicalRooms) - occupied);
      availableRooms = Math.min(availableRooms, available);
      if (configured.stopSell) reasons.add("stop_sell");
      if (dates.length < configured.minNights) reasons.add("minimum_nights");
      if (available === 0) reasons.add("sold_out");
      return {
        stayDate: date,
        basePrice: configured.basePrice,
        sellableStock: configured.sellableStock,
        occupied,
        available,
        minNights: configured.minNights,
        stopSell: configured.stopSell,
      };
    });
    return {
      roomType: type,
      physicalRooms,
      availableRooms,
      assignableRoomUnits: roomUnitsForAssignment,
      capacityMatch: guests ? requiredExtraBeds !== null : null,
      requiredExtraBeds,
      totalPrice: reasons.has("not_configured") ? null : totalPrice,
      bookable: availableRooms > 0 && reasons.size === 0,
      unavailableReasons: [...reasons],
      nightlyRates,
    };
  });
}
