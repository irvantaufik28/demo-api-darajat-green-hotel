import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { reservationRoomNights } from "../../../db/schema/reservation_room_nights.schema.js";
import { reservationRooms } from "../../../db/schema/reservation_rooms.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { roomTypes } from "../../../db/schema/room_types.schema.js";
import { roomUnits } from "../../../db/schema/room_units.schema.js";
import type { ReservationStatus } from "../../reservations/reservation-status.js";
import type { Database } from "../../../plugins/database.js";

export type RoomPerformanceSource = "website" | "phone" | "walk_in" | "ota";
export type RoomPerformanceMode = "actual" | "projected";

export type RoomPerformanceFilters = {
  weekStart: string;
  roomType?: string;
  source?: RoomPerformanceSource;
  mode: RoomPerformanceMode;
};

export type RoomPerformanceMetrics = {
  rooms: number;
  available: number;
  sold: number;
  unsold: number;
  cancelled: number;
  revenue: number;
  occupancy: number;
  arr: number;
};

export type RoomPerformanceByRoom = RoomPerformanceMetrics & {
  roomTypeId: string;
  name: string;
};

export type RoomPerformanceDaily = RoomPerformanceMetrics & {
  date: string;
};

export type RoomPerformanceResult = {
  weekStart: string;
  dates: string[];
  nights: number;
  totalRooms: number;
  total: RoomPerformanceMetrics;
  byRoom: RoomPerformanceByRoom[];
  daily: RoomPerformanceDaily[];
};

// Occupancy counts stays that are actually in-house or completed. Projected mode also
// includes confirmed (not-yet-arrived) reservations.
const occupiedStatuses: Record<RoomPerformanceMode, ReservationStatus[]> = {
  actual: ["checked_in", "checked_out"],
  projected: ["checked_in", "checked_out", "confirmed"],
};

const excludedUnitStatuses = ["maintenance", "out_of_service"];

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function occupancyOf(sold: number, available: number): number {
  return available > 0 ? (sold / available) * 100 : 0;
}

function arrOf(revenue: number, sold: number): number {
  return sold > 0 ? revenue / sold : 0;
}

export async function getRoomPerformanceReport(
  db: Database,
  filters: RoomPerformanceFilters,
): Promise<RoomPerformanceResult> {
  const { weekStart, mode } = filters;
  const dates = Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index));
  const rangeEnd = dates[dates.length - 1];

  // Room types in scope (optionally filtered to one type).
  const typeRows = await db
    .select({ id: roomTypes.id, name: roomTypes.name })
    .from(roomTypes)
    .where(
      and(
        eq(roomTypes.isActive, true),
        filters.roomType ? eq(roomTypes.id, filters.roomType) : undefined,
      ),
    )
    .orderBy(asc(roomTypes.name));

  if (typeRows.length === 0) {
    return {
      weekStart,
      dates,
      nights: dates.length,
      totalRooms: 0,
      total: emptyMetrics(),
      byRoom: [],
      daily: dates.map((date) => ({ date, ...emptyMetrics() })),
    };
  }

  const typeIds = typeRows.map((row) => row.id);
  const typeNameById = new Map(typeRows.map((row) => [row.id, row.name]));

  // Physical, operational room units per type (excludes maintenance / out_of_service).
  const unitRows = await db
    .select({
      roomTypeId: roomUnits.roomTypeId,
      count: sql<number>`count(*)::int`.mapWith(Number),
    })
    .from(roomUnits)
    .where(
      and(
        inArray(roomUnits.roomTypeId, typeIds),
        eq(roomUnits.isActive, true),
        notInArray(roomUnits.operationalStatus, excludedUnitStatuses),
      ),
    )
    .groupBy(roomUnits.roomTypeId);
  const physicalByType = new Map(unitRows.map((row) => [row.roomTypeId, row.count]));

  // Sold room nights + actual revenue per (type, date), scoped to occupied statuses.
  const soldRows = await db
    .select({
      roomTypeId: reservationRooms.roomTypeId,
      stayDate: reservationRoomNights.stayDate,
      sold: sql<number>`count(*)::int`.mapWith(Number),
      revenue: sql<number>`coalesce(sum(${reservationRoomNights.finalPrice}), 0)::bigint`.mapWith(
        Number,
      ),
    })
    .from(reservationRoomNights)
    .innerJoin(reservationRooms, eq(reservationRoomNights.reservationRoomId, reservationRooms.id))
    .innerJoin(reservations, eq(reservationRooms.reservationId, reservations.id))
    .where(
      and(
        inArray(reservationRooms.roomTypeId, typeIds),
        sql`${reservationRoomNights.stayDate} >= ${weekStart}::date`,
        sql`${reservationRoomNights.stayDate} <= ${rangeEnd}::date`,
        inArray(reservations.reservationStatus, occupiedStatuses[mode]),
        filters.source ? eq(reservations.source, filters.source) : undefined,
      ),
    )
    .groupBy(reservationRooms.roomTypeId, reservationRoomNights.stayDate);

  // Cancelled room nights per (type, date).
  const cancelledRows = await db
    .select({
      roomTypeId: reservationRooms.roomTypeId,
      stayDate: reservationRoomNights.stayDate,
      cancelled: sql<number>`count(*)::int`.mapWith(Number),
    })
    .from(reservationRoomNights)
    .innerJoin(reservationRooms, eq(reservationRoomNights.reservationRoomId, reservationRooms.id))
    .innerJoin(reservations, eq(reservationRooms.reservationId, reservations.id))
    .where(
      and(
        inArray(reservationRooms.roomTypeId, typeIds),
        sql`${reservationRoomNights.stayDate} >= ${weekStart}::date`,
        sql`${reservationRoomNights.stayDate} <= ${rangeEnd}::date`,
        eq(reservations.reservationStatus, "cancelled"),
        filters.source ? eq(reservations.source, filters.source) : undefined,
      ),
    )
    .groupBy(reservationRooms.roomTypeId, reservationRoomNights.stayDate);

  const key = (typeId: string, date: string) => `${typeId}|${date}`;
  const soldByKey = new Map(soldRows.map((row) => [key(row.roomTypeId, row.stayDate), row]));
  const cancelledByKey = new Map(
    cancelledRows.map((row) => [key(row.roomTypeId, row.stayDate), row.cancelled]),
  );

  const totalRooms = typeIds.reduce((sum, id) => sum + (physicalByType.get(id) ?? 0), 0);

  // Accumulators for per-type and per-day aggregation.
  const byRoomAcc = new Map<string, RoomPerformanceByRoom>(
    typeRows.map((type) => [
      type.id,
      {
        roomTypeId: type.id,
        name: type.name,
        rooms: physicalByType.get(type.id) ?? 0,
        available: 0,
        sold: 0,
        unsold: 0,
        cancelled: 0,
        revenue: 0,
        occupancy: 0,
        arr: 0,
      },
    ]),
  );
  const daily: RoomPerformanceDaily[] = [];

  for (const date of dates) {
    let daySold = 0;
    let dayRevenue = 0;
    let dayCancelled = 0;
    let dayAvailable = 0;

    for (const type of typeRows) {
      const physical = physicalByType.get(type.id) ?? 0;
      const soldEntry = soldByKey.get(key(type.id, date));
      // Sold room nights are capped at the physical room count per day (mirrors demo logic).
      const sold = Math.min(physical, soldEntry?.sold ?? 0);
      const revenue = soldEntry?.revenue ?? 0;
      const cancelled = cancelledByKey.get(key(type.id, date)) ?? 0;

      dayAvailable += physical;
      daySold += sold;
      dayRevenue += revenue;
      dayCancelled += cancelled;

      const bucket = byRoomAcc.get(type.id)!;
      bucket.available += physical;
      bucket.sold += sold;
      bucket.revenue += revenue;
      bucket.cancelled += cancelled;
    }

    daily.push({
      date,
      rooms: totalRooms,
      available: dayAvailable,
      sold: daySold,
      unsold: dayAvailable - daySold,
      cancelled: dayCancelled,
      revenue: dayRevenue,
      occupancy: occupancyOf(daySold, dayAvailable),
      arr: arrOf(dayRevenue, daySold),
    });
  }

  const byRoom = typeRows.map((type) => {
    const bucket = byRoomAcc.get(type.id)!;
    bucket.unsold = bucket.available - bucket.sold;
    bucket.occupancy = occupancyOf(bucket.sold, bucket.available);
    bucket.arr = arrOf(bucket.revenue, bucket.sold);
    return bucket;
  });

  const total = byRoom.reduce<RoomPerformanceMetrics>((acc, row) => {
    acc.rooms += row.rooms;
    acc.available += row.available;
    acc.sold += row.sold;
    acc.cancelled += row.cancelled;
    acc.revenue += row.revenue;
    return acc;
  }, emptyMetrics());
  total.unsold = total.available - total.sold;
  total.occupancy = occupancyOf(total.sold, total.available);
  total.arr = arrOf(total.revenue, total.sold);

  return {
    weekStart,
    dates,
    nights: dates.length,
    totalRooms,
    total,
    byRoom,
    daily,
  };
}

function emptyMetrics(): RoomPerformanceMetrics {
  return {
    rooms: 0,
    available: 0,
    sold: 0,
    unsold: 0,
    cancelled: 0,
    revenue: 0,
    occupancy: 0,
    arr: 0,
  };
}
