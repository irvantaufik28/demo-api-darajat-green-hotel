import { eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { uuidSchema } from "../../master/master.shared.js";
import { recordReservationEvent } from "../services/reservation-events.service.js";
import { readReservationFinancials } from "../services/reservation-financials.service.js";

type CancelParams = { id: string };
type CancelBody = { reason: string };

const paramsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: uuidSchema },
} as const;

const bodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["reason"],
  properties: { reason: { type: "string", minLength: 1, maxLength: 2000 } },
} as const;

class CancelInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
  }
}

export const reservationCancelRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: CancelParams; Body: CancelBody }>(
    "/:id/cancel",
    {
      preHandler: app.requirePermission("reservations.cancel"),
      schema: { params: paramsSchema, body: bodySchema },
    },
    async (request, reply) => {
      const reason = request.body.reason.trim();
      if (!reason) {
        return reply.code(400).send({
          error: {
            code: "INVALID_CANCELLATION_REASON",
            message: "Cancellation reason is required",
          },
        });
      }

      try {
        const result = await app.db.transaction(async (tx) => {
          const [reservation] = await tx
            .select()
            .from(reservations)
            .where(eq(reservations.id, request.params.id))
            .for("update")
            .limit(1);
          if (!reservation) {
            throw new CancelInputError("RESERVATION_NOT_FOUND", "Reservation not found", 404);
          }
          if (
            reservation.reservationStatus !== "pending" &&
            reservation.reservationStatus !== "confirmed"
          ) {
            throw new CancelInputError(
              "CANCELLATION_NOT_ALLOWED",
              "Only pending or confirmed reservations can be cancelled",
            );
          }

          const financials = await readReservationFinancials(tx, reservation.id);
          const bookingTotal = financials.bookingTotal;
          const paidAmount = financials.netPaidAmount;
          const depositBalance = financials.depositBalance;
          const financialSettlementPending = paidAmount > 0 || depositBalance > 0;

          const cancelledAt = new Date();
          await tx
            .update(reservations)
            .set({
              reservationStatus: "cancelled",
              cancelledAt,
              cancellationReason: reason,
              version: sql`${reservations.version} + 1`,
              updatedAt: cancelledAt,
            })
            .where(eq(reservations.id, reservation.id));

          await recordReservationEvent(tx, {
            reservationId: reservation.id,
            eventType: "reservation.cancelled",
            actorType: "user",
            actorUserId: request.authUser!.id,
            occurredAt: cancelledAt,
            reservationStatusBefore: reservation.reservationStatus,
            reservationStatusAfter: "cancelled",
            paymentStatusBefore: reservation.paymentStatus,
            paymentStatusAfter: reservation.paymentStatus,
            details: {
              reason,
              bookingTotal,
              paidAmount,
              depositBalance,
              cancellationPolicyId: reservation.cancellationPolicyId,
              financialSettlementPending,
            },
          });

          return {
            reservationId: reservation.id,
            bookingCode: reservation.bookingCode,
            reservationStatus: "cancelled" as const,
            paymentStatus: reservation.paymentStatus,
            cancelledAt,
            cancellationReason: reason,
            bookingTotal,
            paidAmount,
            depositBalance,
            cancellationPolicySnapshot: reservation.cancellationPolicySnapshot,
            financialSettlementPending,
          };
        });
        return result;
      } catch (error) {
        if (error instanceof CancelInputError) {
          return reply.code(error.statusCode).send({
            error: { code: error.code, message: error.message },
          });
        }
        throw error;
      }
    },
  );
};
