import { and, eq, gt, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";
import type { Database } from "../../../plugins/database.js";
import { masterItems } from "../../../db/schema/master_items.schema.js";
import { payments } from "../../../db/schema/payments.schema.js";
import { reservationCharges } from "../../../db/schema/reservation_charges.schema.js";
import { reservationRoomExtraBeds } from "../../../db/schema/reservation_room_extra_beds.schema.js";
import { reservationRoomNights } from "../../../db/schema/reservation_room_nights.schema.js";
import { reservationRooms } from "../../../db/schema/reservation_rooms.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { roomInventoryDaily } from "../../../db/schema/room_inventory_daily.schema.js";
import { roomUnits } from "../../../db/schema/room_units.schema.js";
import { bookingDateJakarta, priceRoomNights } from "./reservations-campaigns.service.js";
import { stayDates } from "./reservations-availability.service.js";
import { readReservationFinancials } from "./reservation-financials.service.js";
import { recordReservationEvent } from "./reservation-events.service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryDatabase = Database | Transaction;

export class ExtendStayError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 409) {
    super(message);
  }
}

export async function quoteExtendStay(db: QueryDatabase, reservationId: string, newCheckOutDate: string) {
  const [reservation] = await db.select().from(reservations).where(eq(reservations.id, reservationId)).limit(1);
  if (!reservation) throw new ExtendStayError("RESERVATION_NOT_FOUND", "Reservation not found", 404);
  if (reservation.reservationStatus !== "checked_in") {
    throw new ExtendStayError("EXTEND_STAY_NOT_ALLOWED", "Only checked-in reservations can be extended");
  }
  const dates = stayDates(reservation.checkOutDate, newCheckOutDate);
  if (!dates || newCheckOutDate <= bookingDateJakarta()) {
    throw new ExtendStayError("INVALID_EXTENSION_DATE", "Choose a checkout date after the current checkout and today", 400);
  }

  const rooms = await db.select().from(reservationRooms).where(eq(reservationRooms.reservationId, reservationId));
  if (!rooms.length || rooms.some((room) => !room.roomUnitId)) {
    throw new ExtendStayError("ROOM_ASSIGNMENT_REQUIRED", "Every room must have an assigned room number");
  }
  const typeIds = [...new Set(rooms.map((room) => room.roomTypeId))];
  const unitIds = rooms.map((room) => room.roomUnitId!);
  const [inventory, units, overlapping, activeUnits, extraBeds, charges, financials] = await Promise.all([
    db.select().from(roomInventoryDaily).where(and(inArray(roomInventoryDaily.roomTypeId, typeIds), gte(roomInventoryDaily.stayDate, dates[0]), lte(roomInventoryDaily.stayDate, dates.at(-1)!))),
    db.select().from(roomUnits).where(inArray(roomUnits.id, unitIds)),
    db.select({ roomUnitId: reservationRooms.roomUnitId, roomTypeId: reservationRooms.roomTypeId, checkInDate: reservations.checkInDate, checkOutDate: reservations.checkOutDate })
      .from(reservationRooms).innerJoin(reservations, eq(reservationRooms.reservationId, reservations.id))
      .where(and(ne(reservations.id, reservationId), inArray(reservationRooms.roomTypeId, typeIds), inArray(reservations.reservationStatus, ["pending", "confirmed", "checked_in"]), lt(reservations.checkInDate, newCheckOutDate), gt(reservations.checkOutDate, dates[0]))),
    db.select({ id: roomUnits.id, roomTypeId: roomUnits.roomTypeId }).from(roomUnits)
      .where(and(inArray(roomUnits.roomTypeId, typeIds), eq(roomUnits.isActive, true), sql`${roomUnits.operationalStatus} not in ('maintenance', 'out_of_service')`)),
    db.select().from(reservationRoomExtraBeds).where(inArray(reservationRoomExtraBeds.reservationRoomId, rooms.map((room) => room.id))),
    db.select().from(reservationCharges).where(eq(reservationCharges.reservationId, reservationId)),
    readReservationFinancials(db, reservationId),
  ]);
  for (const room of rooms) {
    const unit = units.find((item) => item.id === room.roomUnitId);
    if (!unit || !unit.isActive || ["maintenance", "out_of_service"].includes(unit.operationalStatus)) {
      throw new ExtendStayError("ROOM_UNIT_UNAVAILABLE", `Room ${unit?.roomNumber ?? room.roomUnitId} cannot be extended`);
    }
    if (overlapping.some((item) => item.roomUnitId === room.roomUnitId)) {
      throw new ExtendStayError("ROOM_UNIT_UNAVAILABLE", `Room ${unit.roomNumber} is booked during the extension`);
    }
  }
  const inventoryByKey = new Map(inventory.map((row) => [`${row.roomTypeId}:${row.stayDate}`, row]));
  const totalStayNights = stayDates(reservation.checkInDate, newCheckOutDate)?.length ?? dates.length;
  for (const date of dates) {
    for (const typeId of typeIds) {
      const configured = inventoryByKey.get(`${typeId}:${date}`);
      const requested = rooms.filter((room) => room.roomTypeId === typeId).length;
      const occupied = overlapping.filter((room) => room.roomTypeId === typeId && room.checkInDate <= date && room.checkOutDate > date).length;
      const physical = activeUnits.filter((unit) => unit.roomTypeId === typeId).length;
      if (!configured || configured.stopSell || configured.minNights > totalStayNights || Math.min(configured.sellableStock, physical) - occupied < requested) {
        throw new ExtendStayError("ROOM_UNAVAILABLE", `Room type is unavailable on ${date}`);
      }
    }
  }

  const priced = await priceRoomNights(db, {
    source: reservation.source as "website" | "phone" | "walk_in" | "ota",
    bookingDate: bookingDateJakarta(),
    nights: totalStayNights,
    roomCount: rooms.length,
    rows: rooms.flatMap((room, roomIndex) => dates.map((stayDate) => ({
      roomIndex, roomTypeId: room.roomTypeId, stayDate,
      basePrice: inventoryByKey.get(`${room.roomTypeId}:${stayDate}`)!.basePrice,
    }))),
  });
  const originalNights = stayDates(reservation.checkInDate, reservation.checkOutDate)?.length ?? 1;
  const roomLines = rooms.map((room, roomIndex) => {
    const roomNights = priced.rows.filter((row) => row.roomIndex === roomIndex);
    const latestBed = extraBeds.filter((item) => item.reservationRoomId === room.id && item.dateTo === reservation.checkOutDate).at(-1);
    const breakfastGroups = new Map<string, { description: string; quantity: number; unitAmount: number }>();
    for (const charge of charges.filter((item) => item.reservationRoomId === room.id && item.kind === "breakfast")) {
      const description = charge.description.replace(/ · extension$/, "");
      const key = `${description}:${charge.unitAmount}`;
      const current = breakfastGroups.get(key);
      breakfastGroups.set(key, { description, unitAmount: charge.unitAmount, quantity: (current?.quantity ?? 0) + Number(charge.quantity) });
    }
    const breakfasts = [...breakfastGroups.values()]
      .map((item) => ({ description: item.description, quantityPerNight: item.quantity / originalNights, unitAmount: item.unitAmount }))
      .filter((item) => Number.isInteger(item.quantityPerNight) && item.quantityPerNight > 0);
    const extraBedAmount = latestBed ? latestBed.quantity * latestBed.unitPricePerNight * dates.length : 0;
    const breakfastAmount = breakfasts.reduce((sum, item) => sum + item.quantityPerNight * item.unitAmount * dates.length, 0);
    return {
      reservationRoomId: room.id,
      roomTypeName: room.roomTypeNameSnapshot,
      roomNumber: units.find((unit) => unit.id === room.roomUnitId)?.roomNumber ?? null,
      nights: roomNights,
      roomAmount: roomNights.reduce((sum, night) => sum + night.finalPrice, 0),
      extraBeds: latestBed ? { quantity: latestBed.quantity, unitPricePerNight: latestBed.unitPricePerNight, amount: extraBedAmount } : null,
      breakfasts,
      breakfastAmount,
      total: roomNights.reduce((sum, night) => sum + night.finalPrice, 0) + extraBedAmount + breakfastAmount,
    };
  });
  const extensionTotal = roomLines.reduce((sum, room) => sum + room.total, 0);
  return {
    reservationId, oldCheckOutDate: reservation.checkOutDate, newCheckOutDate,
    nights: dates.length, rooms: roomLines, discountTotal: priced.discountTotal,
    extensionTotal, existingBalance: financials.remainingBalance,
    projectedBalance: financials.remainingBalance + extensionTotal,
    version: reservation.version,
  };
}

export async function saveExtendStay(tx: Transaction, input: {
  reservationId: string; newCheckOutDate: string; expectedVersion: number;
  actorUserId: string; payment?: { methodId: string; amount: number };
}) {
  const [reservation] = await tx.select().from(reservations).where(eq(reservations.id, input.reservationId)).for("update").limit(1);
  if (!reservation) throw new ExtendStayError("RESERVATION_NOT_FOUND", "Reservation not found", 404);
  if (reservation.version !== input.expectedVersion) throw new ExtendStayError("RESERVATION_CHANGED", "Reservation changed. Review the extension quote again");
  const roomTypeIds = [...new Set((await tx.select({ roomTypeId: reservationRooms.roomTypeId }).from(reservationRooms).where(eq(reservationRooms.reservationId, input.reservationId))).map((room) => room.roomTypeId))];
  for (const roomTypeId of roomTypeIds.sort()) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${roomTypeId}))`);
  const quote = await quoteExtendStay(tx, input.reservationId, input.newCheckOutDate);
  if (input.payment) {
    const [method] = await tx.select({ id: masterItems.id }).from(masterItems).where(and(eq(masterItems.id, input.payment.methodId), eq(masterItems.category, "payment_methods"), eq(masterItems.isActive, true))).limit(1);
    if (!method || input.payment.amount < 1 || input.payment.amount > quote.projectedBalance) throw new ExtendStayError("INVALID_PAYMENT", "Choose an active payment method and valid amount", 400);
  }
  for (const room of quote.rooms) {
    await tx.insert(reservationRoomNights).values(room.nights.map((night) => ({
      reservationRoomId: room.reservationRoomId, stayDate: night.stayDate,
      basePrice: night.basePrice, discountAmount: night.discountAmount,
      finalPrice: night.finalPrice, campaignSnapshot: night.campaignSnapshot,
    })));
    await tx.insert(reservationCharges).values({
      reservationId: input.reservationId, reservationRoomId: room.reservationRoomId,
      kind: "extension", description: `Extend stay · ${room.roomTypeName} · ${quote.nights} night(s)`,
      quantity: "1", unitAmount: room.roomAmount, amount: room.roomAmount,
      createdByUserId: input.actorUserId,
    });
    if (room.extraBeds) {
      await tx.insert(reservationRoomExtraBeds).values({ reservationRoomId: room.reservationRoomId, quantity: room.extraBeds.quantity, dateFrom: quote.oldCheckOutDate, dateTo: quote.newCheckOutDate, unitPricePerNight: room.extraBeds.unitPricePerNight });
      await tx.insert(reservationCharges).values({ reservationId: input.reservationId, reservationRoomId: room.reservationRoomId, kind: "extra_bed", description: `Extra bed extension · ${room.roomTypeName}`, quantity: String(room.extraBeds.quantity * quote.nights), unitAmount: room.extraBeds.unitPricePerNight, amount: room.extraBeds.amount, createdByUserId: input.actorUserId });
    }
    for (const breakfast of room.breakfasts) {
      await tx.insert(reservationCharges).values({ reservationId: input.reservationId, reservationRoomId: room.reservationRoomId, kind: "breakfast", description: `${breakfast.description} · extension`, quantity: String(breakfast.quantityPerNight * quote.nights), unitAmount: breakfast.unitAmount, amount: breakfast.quantityPerNight * quote.nights * breakfast.unitAmount, createdByUserId: input.actorUserId });
    }
  }
  if (input.payment) {
    await tx.insert(payments).values({ reservationId: input.reservationId, methodId: input.payment.methodId, amount: input.payment.amount, status: "succeeded", paidAt: new Date(), recordedByUserId: input.actorUserId, notes: "Extend stay payment" });
  }
  const financials = await readReservationFinancials(tx, input.reservationId);
  const paymentStatus = financials.remainingBalance === 0 ? "paid" : financials.netPaidAmount > 0 ? "partial" : "unpaid";
  await tx.update(reservations).set({ checkOutDate: input.newCheckOutDate, paymentStatus, version: sql`${reservations.version} + 1`, updatedAt: new Date() }).where(eq(reservations.id, input.reservationId));
  await recordReservationEvent(tx, { reservationId: input.reservationId, eventType: "reservation.stay_extended", actorType: "user", actorUserId: input.actorUserId, reservationStatusBefore: "checked_in", reservationStatusAfter: "checked_in", paymentStatusBefore: reservation.paymentStatus, paymentStatusAfter: paymentStatus, details: { oldCheckOutDate: quote.oldCheckOutDate, newCheckOutDate: quote.newCheckOutDate, nights: quote.nights, extensionTotal: quote.extensionTotal, paymentAmount: input.payment?.amount ?? 0, remainingBalance: financials.remainingBalance, rooms: quote.rooms.map((room) => ({ reservationRoomId: room.reservationRoomId, total: room.total })) } });
  if (input.payment) {
    await recordReservationEvent(tx, { reservationId: input.reservationId, eventType: "payment.recorded", actorType: "user", actorUserId: input.actorUserId, reservationStatusBefore: "checked_in", reservationStatusAfter: "checked_in", paymentStatusBefore: reservation.paymentStatus, paymentStatusAfter: paymentStatus, details: { amount: input.payment.amount, methodId: input.payment.methodId, context: "extend_stay" } });
  }
  return { ...quote, paymentStatus, remainingBalance: financials.remainingBalance };
}
