import { eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { reservations } from "../../db/schema/reservations.schema.js";
import { uuidSchema } from "../master/master.shared.js";
import { recordReservationEvent } from "./reservation-events.service.js";

type ConfirmParams = { id: string };

const paramsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: uuidSchema },
} as const;

export const reservationConfirmRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: ConfirmParams }>(
    "/:id/confirm",
    {
      preHandler: app.requirePermission("reservations.confirm"),
      schema: { params: paramsSchema },
    },
    async (request, reply) => {
      const result = await app.db.transaction(async (tx) => {
        const [reservation] = await tx
          .select()
          .from(reservations)
          .where(eq(reservations.id, request.params.id))
          .for("update")
          .limit(1);

        if (!reservation) return { error: "RESERVATION_NOT_FOUND" as const };
        if (reservation.source !== "phone" && reservation.source !== "walk_in") {
          return { error: "CONFIRMATION_NOT_ALLOWED" as const };
        }
        if (reservation.reservationStatus !== "pending") {
          return { error: "INVALID_RESERVATION_STATUS" as const };
        }
        if (!(["unpaid", "partial", "paid"] as string[]).includes(reservation.paymentStatus)) {
          return { error: "INVALID_PAYMENT_STATUS" as const };
        }

        const confirmedAt = new Date();
        await tx
          .update(reservations)
          .set({
            reservationStatus: "confirmed",
            confirmedAt,
            version: sql`${reservations.version} + 1`,
            updatedAt: confirmedAt,
          })
          .where(eq(reservations.id, reservation.id));

        await recordReservationEvent(tx, {
          reservationId: reservation.id,
          eventType: "reservation.confirmed",
          actorType: "user",
          actorUserId: request.authUser!.id,
          occurredAt: confirmedAt,
          reservationStatusBefore: "pending",
          reservationStatusAfter: "confirmed",
          paymentStatusBefore: reservation.paymentStatus,
          paymentStatusAfter: reservation.paymentStatus,
          details: { bookingCode: reservation.bookingCode, source: reservation.source },
        });

        return {
          reservation: {
            id: reservation.id,
            bookingCode: reservation.bookingCode,
            reservationStatus: "confirmed" as const,
            paymentStatus: reservation.paymentStatus,
            confirmedAt,
            confirmedBy: { id: request.authUser!.id, name: request.authUser!.name },
          },
        };
      });

      if (result.error) {
        const statusCode = result.error === "RESERVATION_NOT_FOUND" ? 404 : 409;
        const messages = {
          RESERVATION_NOT_FOUND: "Reservation not found",
          CONFIRMATION_NOT_ALLOWED: "Only Phone and Walk-in reservations can be confirmed manually",
          INVALID_RESERVATION_STATUS: "Only pending reservations can be confirmed",
          INVALID_PAYMENT_STATUS: "Payment status must be Unpaid, Partial, or Paid",
        };
        return reply.code(statusCode).send({
          error: { code: result.error, message: messages[result.error] },
        });
      }

      return result;
    },
  );
};
