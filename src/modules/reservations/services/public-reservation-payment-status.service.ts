import { desc, eq } from "drizzle-orm";
import { paymentSessions } from "../../../db/schema/payment_sessions.schema.js";
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

  return {
    id: reservation.id,
    bookingCode: reservation.bookingCode,
    reservationStatus: reservation.reservationStatus,
    paymentStatus: reservation.paymentStatus,
    bookingTotal: financials.bookingTotal,
    paidAmount: financials.netPaidAmount,
    remainingBalance: financials.remainingBalance,
    currency: "IDR" as const,
    paymentExpiresAt: reservation.paymentExpiresAt?.toISOString() ?? null,
    paymentSession: session
      ? { status: session.status, expiresAt: session.expiresAt.toISOString() }
      : null,
  };
}
