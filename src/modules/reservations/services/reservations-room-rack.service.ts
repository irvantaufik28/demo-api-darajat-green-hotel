import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { guests } from "../../../db/schema/guests.schema.js";
import { masterItems } from "../../../db/schema/master_items.schema.js";
import { reservationRooms } from "../../../db/schema/reservation_rooms.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { roomInventoryDaily } from "../../../db/schema/room_inventory_daily.schema.js";
import { roomTypes } from "../../../db/schema/room_types.schema.js";
import { roomUnits } from "../../../db/schema/room_units.schema.js";
import type { Database } from "../../../plugins/database.js";
import { readActiveMaintenanceBlocks } from "../../rooms/services/room-maintenance.service.js";
import { resolveReservationOperationalStatus } from "../reservations-operational-status.js";
import type { RoomRackQuery } from "../schemas/reservations-room-rack.schema.js";
import { getCheckOutClock } from "./reservation-check-out-time.service.js";
import {
  bookingDateJakarta,
  previewDailyCampaignPrices,
} from "./reservations-campaigns.service.js";

const occupyingStatuses = new Set(["pending", "confirmed", "checked_in"]);
const visibleStatuses = ["pending", "confirmed", "checked_in", "checked_out"] as const;

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function jakartaDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function displayCheckOutDate(booking: {
  checkInDate: string;
  checkOutDate: string;
  checkedOutAt: Date | null;
  reservationStatus: string;
}, serverDate: string): string {
  if (booking.reservationStatus === "checked_in" && booking.checkOutDate <= serverDate) {
    return addDays(serverDate, 1);
  }
  if (booking.reservationStatus === "checked_out" && booking.checkedOutAt) {
    const actualDate = jakartaDate(booking.checkedOutAt);
    return actualDate === booking.checkInDate ? addDays(actualDate, 1) : actualDate;
  }
  return booking.checkOutDate;
}

export function validRoomRackDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function readRoomRack(db: Database, query: RoomRackQuery) {
  const { startDate, days = 14, roomTypeId } = query;
  const dates = Array.from({ length: days }, (_, index) => addDays(startDate, index));
  const endDateExclusive = addDays(startDate, days);
  const clock = await getCheckOutClock(db);
  const typeFilter = roomTypeId ? eq(roomTypes.id, roomTypeId) : undefined;
  const unitFilter = roomTypeId ? eq(roomUnits.roomTypeId, roomTypeId) : undefined;
  const bookingFilter = roomTypeId
    ? eq(reservationRooms.roomTypeId, roomTypeId)
    : undefined;
  const inventoryFilter = roomTypeId
    ? eq(roomInventoryDaily.roomTypeId, roomTypeId)
    : undefined;

  const [types, units, bookings, inventory, maintenanceBlocks, overdueUnassignedRows] = await Promise.all([
    db
      .select({
        id: roomTypes.id,
        code: roomTypes.code,
        name: roomTypes.name,
        bedTypeName: masterItems.name,
        isActive: roomTypes.isActive,
      })
      .from(roomTypes)
      .leftJoin(masterItems, eq(roomTypes.bedTypeId, masterItems.id))
      .where(typeFilter)
      .orderBy(asc(roomTypes.name), asc(roomTypes.id)),
    db
      .select({
        id: roomUnits.id,
        roomTypeId: roomUnits.roomTypeId,
        roomNumber: roomUnits.roomNumber,
        floorId: roomUnits.floorId,
        floorName: masterItems.name,
        bedConfiguration: roomUnits.bedConfiguration,
        operationalStatus: roomUnits.operationalStatus,
        isActive: roomUnits.isActive,
      })
      .from(roomUnits)
      .leftJoin(masterItems, eq(roomUnits.floorId, masterItems.id))
      .where(unitFilter)
      .orderBy(asc(roomUnits.roomNumber), asc(roomUnits.id)),
    db
      .select({
        reservationRoomId: reservationRooms.id,
        reservationId: reservations.id,
        roomTypeId: reservationRooms.roomTypeId,
        roomUnitId: reservationRooms.roomUnitId,
        adults: reservationRooms.adults,
        children: reservationRooms.children,
        bookingCode: reservations.bookingCode,
        source: reservations.source,
        otaChannelName: masterItems.name,
        checkInDate: reservations.checkInDate,
        checkOutDate: reservations.checkOutDate,
        reservationStatus: reservations.reservationStatus,
        paymentStatus: reservations.paymentStatus,
        checkedOutAt: reservations.checkedOutAt,
        guestId: guests.id,
        guestName: guests.fullName,
        guestPhone: guests.phone,
      })
      .from(reservationRooms)
      .innerJoin(reservations, eq(reservationRooms.reservationId, reservations.id))
      .innerJoin(guests, eq(reservations.guestId, guests.id))
      .leftJoin(masterItems, eq(reservations.otaChannelId, masterItems.id))
      .where(
        and(
          bookingFilter,
          inArray(reservations.reservationStatus, visibleStatuses),
          lt(reservations.checkInDate, endDateExclusive),
          or(
            gt(reservations.checkOutDate, startDate),
            eq(reservations.reservationStatus, "checked_in"),
            and(
              eq(reservations.reservationStatus, "checked_out"),
              gte(reservations.checkedOutAt, new Date(`${startDate}T00:00:00+07:00`)),
            ),
          ),
        ),
      )
      .orderBy(asc(reservations.checkInDate), asc(reservations.bookingCode), asc(reservationRooms.id)),
    db
      .select({
        roomTypeId: roomInventoryDaily.roomTypeId,
        stayDate: roomInventoryDaily.stayDate,
        basePrice: roomInventoryDaily.basePrice,
        sellableStock: roomInventoryDaily.sellableStock,
        minNights: roomInventoryDaily.minNights,
        stopSell: roomInventoryDaily.stopSell,
        version: roomInventoryDaily.version,
      })
      .from(roomInventoryDaily)
      .where(
        and(
          inventoryFilter,
          gte(roomInventoryDaily.stayDate, startDate),
          lte(roomInventoryDaily.stayDate, dates[dates.length - 1]),
        ),
      ),
    readActiveMaintenanceBlocks(db, startDate, endDateExclusive, roomTypeId ? [roomTypeId] : undefined),
    db
      .select({
        reservationId: reservations.id,
        reservationRoomId: sql<string>`(array_agg(${reservationRooms.id} order by ${reservationRooms.createdAt}, ${reservationRooms.id}))[1]`,
        bookingCode: reservations.bookingCode,
        guestName: guests.fullName,
        roomTypeId: roomTypes.id,
        roomTypeName: roomTypes.name,
        source: reservations.source,
        paymentStatus: reservations.paymentStatus,
        checkInDate: reservations.checkInDate,
        checkOutDate: reservations.checkOutDate,
        unassignedRooms: sql<number>`count(*)::int`.mapWith(Number),
      })
      .from(reservationRooms)
      .innerJoin(reservations, eq(reservationRooms.reservationId, reservations.id))
      .innerJoin(guests, eq(reservations.guestId, guests.id))
      .innerJoin(roomTypes, eq(reservationRooms.roomTypeId, roomTypes.id))
      .where(
        and(
          bookingFilter,
          eq(reservations.reservationStatus, "confirmed"),
          isNull(reservationRooms.roomUnitId),
          lte(reservations.checkOutDate, startDate),
          lte(reservations.checkOutDate, bookingDateJakarta()),
        ),
      )
      .groupBy(reservations.id, guests.id, roomTypes.id)
      .orderBy(desc(reservations.checkOutDate), asc(reservations.bookingCode), asc(roomTypes.name))
      .limit(51),
  ]);

  const bookingRows = bookings.map((booking) => ({
    ...booking,
    displayCheckOutDate: displayCheckOutDate(booking, clock.serverDate),
    operationalStatus: resolveReservationOperationalStatus(
      booking.reservationStatus,
      booking.checkInDate,
      booking.checkOutDate,
      clock,
    ),
  })).filter((booking) =>
    booking.checkInDate < booking.displayCheckOutDate &&
    booking.checkInDate < endDateExclusive &&
    booking.displayCheckOutDate > startDate,
  );
  const inventoryByKey = new Map(
    inventory.map((row) => [`${row.roomTypeId}:${row.stayDate}`, row]),
  );
  const bookingDate = bookingDateJakarta();

  const groups = await Promise.all(types.map(async (type) => {
    const typeUnits = units.filter((unit) => unit.roomTypeId === type.id);
    const typeBookings = bookingRows.filter((booking) => booking.roomTypeId === type.id);
    const typeMaintenance = maintenanceBlocks.filter((block) => block.roomTypeId === type.id);
    const operationalUnits = typeUnits.filter(
      (unit) => unit.isActive && !["maintenance", "out_of_service"].includes(unit.operationalStatus),
    );
    const dayRows = dates.map((stayDate) => ({
      stayDate,
      configured: inventoryByKey.get(`${type.id}:${stayDate}`),
    }));
    const campaignPreviews = await previewDailyCampaignPrices(db, {
      bookingDate,
      roomTypeId: type.id,
      rows: dayRows.map(({ stayDate, configured }) => ({
        stayDate,
        basePrice: configured?.basePrice ?? null,
      })),
    });

    return {
      roomType: type,
      rooms: typeUnits.map((unit) => ({
        ...unit,
        reservations: typeBookings.filter((booking) => booking.roomUnitId === unit.id),
        maintenanceBlocks: typeMaintenance.filter((block) => block.roomUnitId === unit.id),
      })),
      unassignedReservations: typeBookings.filter((booking) => booking.roomUnitId === null),
      inventory: dayRows.map(({ stayDate, configured }, index) => {
        const occupying = typeBookings.filter(
          (booking) =>
            occupyingStatuses.has(booking.reservationStatus) &&
            booking.checkInDate <= stayDate &&
            booking.displayCheckOutDate > stayDate,
        );
        const bookedRooms = occupying.length;
        const unassignedRooms = occupying.filter((booking) => booking.roomUnitId === null).length;
        const assignedUnitIds = new Set(
          occupying.map((booking) => booking.roomUnitId).filter((id): id is string => id !== null),
        );
        const blockedUnitIds = new Set(
          typeMaintenance
            .filter((block) => block.startDate <= stayDate && block.endDate > stayDate)
            .map((block) => block.roomUnitId),
        );
        const maintenanceBlockedRooms = operationalUnits.filter((unit) => blockedUnitIds.has(unit.id)).length;
        const requiresReadyRoom = stayDate <= bookingDate;
        const physicallyFreeRooms = operationalUnits.filter(
          (unit) =>
            !assignedUnitIds.has(unit.id) &&
            !blockedUnitIds.has(unit.id) &&
            (!requiresReadyRoom || unit.operationalStatus === "available"),
        ).length;
        const sellableStock = configured?.sellableStock ?? null;
        const availableRooms = configured
          ? configured.stopSell
            ? 0
            : Math.max(0, Math.min(configured.sellableStock, operationalUnits.length - maintenanceBlockedRooms) - bookedRooms)
          : null;

        return {
          stayDate,
          isConfigured: Boolean(configured),
          basePrice: configured?.basePrice ?? null,
          sellableStock,
          minNights: configured?.minNights ?? null,
          stopSell: configured?.stopSell ?? null,
          version: configured?.version ?? null,
          bookedRooms,
          unassignedRooms,
          maintenanceBlockedRooms,
          remainingStock: sellableStock === null ? null : Math.max(0, sellableStock - bookedRooms),
          availableRooms,
          physicallyFreeRooms,
          freeRoomsAfterUnassigned: Math.max(0, physicallyFreeRooms - unassignedRooms),
          heldForUnassigned:
            stayDate >= bookingDate &&
            unassignedRooms > 0 &&
            physicallyFreeRooms <= unassignedRooms,
          websitePromo: campaignPreviews[index]?.website.promo ?? null,
          webPrice: campaignPreviews[index]?.website.price ?? null,
          frontDeskPromo: campaignPreviews[index]?.frontDesk.promo ?? null,
          frontDeskPrice: campaignPreviews[index]?.frontDesk.price ?? null,
        };
      }),
    };
  }));

  return {
    startDate,
    endDateExclusive,
    days,
    dates,
    serverDate: clock.serverDate,
    campaignPreviewBookingDate: bookingDate,
    overdueUnassigned: overdueUnassignedRows.slice(0, 50),
    overdueUnassignedHasMore: overdueUnassignedRows.length > 50,
    groups,
  };
}
