import { and, eq, isNotNull, lte, notExists, inArray, sql } from "drizzle-orm";
import { paymentSessions } from "../../../db/schema/payment_sessions.schema.js";
import type { Database } from "../../../plugins/database.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { recordReservationEvent } from "./reservation-events.service.js";

export async function expireDueWebsiteReservations(db: Database, limit = 100) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const due = await tx
      .select({
        id: reservations.id,
        bookingCode: reservations.bookingCode,
        paymentExpiresAt: reservations.paymentExpiresAt,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.source, "website"),
          eq(reservations.reservationStatus, "pending"),
          eq(reservations.paymentStatus, "unpaid"),
          isNotNull(reservations.paymentExpiresAt),
          lte(reservations.paymentExpiresAt, now),
          notExists(
            tx
              .select({ id: paymentSessions.id })
              .from(paymentSessions)
              .where(
                and(
                  eq(paymentSessions.reservationId, reservations.id),
                  inArray(paymentSessions.status, ["creating", "active"]),
                ),
              ),
          ),
        ),
      )
      .orderBy(reservations.paymentExpiresAt)
      .limit(limit)
      .for("update", { skipLocked: true });
    for (const reservation of due) {
      await tx
        .update(reservations)
        .set({
          reservationStatus: "expired",
          paymentStatus: "expired",
          expiredAt: now,
          version: sql`${reservations.version} + 1`,
          updatedAt: now,
        })
        .where(eq(reservations.id, reservation.id));
      await recordReservationEvent(tx, {
        reservationId: reservation.id,
        eventType: "reservation.expired",
        actorType: "system",
        reservationStatusBefore: "pending",
        reservationStatusAfter: "expired",
        paymentStatusBefore: "unpaid",
        paymentStatusAfter: "expired",
        details: {
          bookingCode: reservation.bookingCode,
          paymentExpiresAt: reservation.paymentExpiresAt?.toISOString() ?? null,
          reason: "website_payment_timeout",
        },
      });
    }
    return due.length;
  });
}
