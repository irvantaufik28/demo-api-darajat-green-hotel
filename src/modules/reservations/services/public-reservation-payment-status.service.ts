import { desc, eq, inArray } from "drizzle-orm";
import { paymentSessions } from "../../../db/schema/payment_sessions.schema.js";
import { reservationRoomNights } from "../../../db/schema/reservation_room_nights.schema.js";
import { reservationRooms } from "../../../db/schema/reservation_rooms.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import type { Database } from "../../../plugins/database.js";
import { readReservationFinancials } from "./reservation-financials.service.js";

export async function getPublicReservationPaymentStatus(db: Database, reservationId: string) {
  const [reservation] = await db
    .select({
      id: reservations.id,
      bookingCode: reservations.bookingCode,
      source: reservations.source,
      reservationStatus: reservations.reservationStatus,
      paymentStatus: reservations.paymentStatus,
      paymentExpiresAt: reservations.paymentExpiresAt,
    })
    .from(reservations)
    .where(eq(reservations.id, reservationId))
    .limit(1);

  if (!reservation || reservation.source !== "website") return null;

  const [financials, [session]] = await Promise.all([
    readReservationFinancials(db, reservationId),
    db
      .select({ status: paymentSessions.status, expiresAt: paymentSessions.expiresAt })
      .from(paymentSessions)
      .where(eq(paymentSessions.reservationId, reservationId))
      .orderBy(desc(paymentSessions.createdAt), desc(paymentSessions.id))
      .limit(1),
  ]);

  const roomRows = await db
    .select({ id: reservationRooms.id, name: reservationRooms.roomTypeNameSnapshot })
    .from(reservationRooms)
    .where(eq(reservationRooms.reservationId, reservationId));
  const nightRows = roomRows.length
    ? await db
        .select({
          reservationRoomId: reservationRoomNights.reservationRoomId,
          basePrice: reservationRoomNights.basePrice,
          discountAmount: reservationRoomNights.discountAmount,
        })
        .from(reservationRoomNights)
        .where(inArray(reservationRoomNights.reservationRoomId, roomRows.map((room) => room.id)))
    : [];
  const rooms = roomRows.map((room) => {
    const nights = nightRows.filter((night) => night.reservationRoomId === room.id);
    return {
      name: room.name,
      nights: nights.length,
      baseAmount: nights.reduce((sum, night) => sum + night.basePrice, 0),
      discountAmount: nights.reduce((sum, night) => sum + night.discountAmount, 0),
      finalAmount: financials.charges
        .filter((charge) => charge.kind === "room" && charge.reservationRoomId === room.id)
        .reduce((sum, charge) => sum + charge.amount, 0),
    };
  });
  const latestPayment = financials.payments
    .filter((payment) => ["succeeded", "partially_refunded", "refunded"].includes(payment.status))
    .sort((left, right) => (right.paidAt?.getTime() ?? 0) - (left.paidAt?.getTime() ?? 0))[0];

  return {
    id: reservation.id,
    bookingCode: reservation.bookingCode,
    reservationStatus: reservation.reservationStatus,
    paymentStatus: reservation.paymentStatus,
    bookingTotal: financials.bookingTotal,
    paidAmount: financials.netPaidAmount,
    remainingBalance: financials.remainingBalance,
    summary: {
      rooms,
      extras: financials.charges
        .filter((charge) => charge.kind !== "room")
        .map((charge) => ({
          kind: charge.kind,
          description: charge.description,
          quantity: Number(charge.quantity),
          amount: charge.amount,
        })),
      payment: latestPayment
        ? {
            provider: latestPayment.provider,
            reference: latestPayment.providerReference,
            paidAt: latestPayment.paidAt?.toISOString() ?? null,
            amount: latestPayment.amount,
          }
        : null,
    },
    currency: "IDR" as const,
    paymentExpiresAt: reservation.paymentExpiresAt?.toISOString() ?? null,
    paymentSession: session
      ? { status: session.status, expiresAt: session.expiresAt.toISOString() }
      : null,
  };
}
