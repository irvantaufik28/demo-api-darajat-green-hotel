import { and, eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { masterItems } from "../../../db/schema/master_items.schema.js";
import { payments } from "../../../db/schema/payments.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { uuidSchema } from "../../master/master.shared.js";
import { recordReservationEvent } from "../services/reservation-events.service.js";
import { readReservationFinancials } from "../services/reservation-financials.service.js";

type PaymentParams = { id: string };
type PaymentBody = {
  idempotencyKey: string;
  methodId: string;
  amount: number;
  notes?: string | null;
};

const paramsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: uuidSchema },
} as const;

const bodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["idempotencyKey", "methodId", "amount"],
  properties: {
    idempotencyKey: { type: "string", minLength: 8, maxLength: 160 },
    methodId: uuidSchema,
    amount: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    notes: { anyOf: [{ type: "string", maxLength: 2000 }, { type: "null" }] },
  },
} as const;

class PaymentInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

export const reservationPaymentRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: PaymentParams; Body: PaymentBody }>(
    "/:id/payments",
    {
      preHandler: app.requirePermission("payments.record"),
      schema: { params: paramsSchema, body: bodySchema },
    },
    async (request, reply) => {
      const idempotencyKey = request.body.idempotencyKey.trim();
      const notes = request.body.notes?.trim() || null;
      if (idempotencyKey.length < 8) {
        return reply.code(400).send({
          error: { code: "INVALID_IDEMPOTENCY_KEY", message: "Use at least 8 characters" },
        });
      }
      try {
        const outcome = await app.db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`reservation-payment:${idempotencyKey}`}))`,
          );
          const [reservation] = await tx
            .select()
            .from(reservations)
            .where(eq(reservations.id, request.params.id))
            .for("update")
            .limit(1);
          if (!reservation) {
            throw new PaymentInputError("RESERVATION_NOT_FOUND", "Reservation not found", 404);
          }
          const [existing] = await tx
            .select()
            .from(payments)
            .where(eq(payments.idempotencyKey, idempotencyKey))
            .limit(1);
          if (existing) {
            if (
              existing.reservationId !== reservation.id ||
              existing.methodId !== request.body.methodId ||
              existing.amount !== request.body.amount ||
              existing.notes !== notes
            ) {
              throw new PaymentInputError(
                "IDEMPOTENCY_KEY_REUSED",
                "Idempotency key was already used with different payment details",
                409,
              );
            }
            const [existingMethod] = await tx
              .select({ id: masterItems.id, name: masterItems.name })
              .from(masterItems)
              .where(eq(masterItems.id, existing.methodId))
              .limit(1);
            const financials = await readReservationFinancials(tx, reservation.id);
            return {
              replayed: true,
              result: {
                payment: { ...existing, method: existingMethod ?? null },
                bookingTotal: financials.bookingTotal,
                paidAmount: financials.netPaidAmount,
                remainingBalance: financials.remainingBalance,
                paymentStatus: reservation.paymentStatus,
                reservationStatus: reservation.reservationStatus,
              },
            };
          }
          if (
            reservation.reservationStatus === "no_show" ||
            reservation.reservationStatus === "cancelled" ||
            reservation.reservationStatus === "expired"
          ) {
            throw new PaymentInputError(
              "PAYMENT_NOT_ALLOWED",
              "Payment cannot be recorded for a no-show, cancelled, or expired reservation",
              409,
            );
          }

          const [method] = await tx
            .select({ id: masterItems.id, name: masterItems.name })
            .from(masterItems)
            .where(
              and(
                eq(masterItems.id, request.body.methodId),
                eq(masterItems.category, "payment_methods"),
                eq(masterItems.isActive, true),
              ),
            )
            .limit(1);
          if (!method) {
            throw new PaymentInputError(
              "INVALID_PAYMENT_METHOD",
              "Payment method not found or inactive",
            );
          }

          const financials = await readReservationFinancials(tx, reservation.id);
          const { bookingTotal, remainingBalance: remainingBefore } = financials;
          if (remainingBefore === 0 || request.body.amount > remainingBefore) {
            throw new PaymentInputError(
              "INVALID_PAYMENT_AMOUNT",
              "Payment amount must not exceed the remaining balance",
              409,
            );
          }

          const [payment] = await tx
            .insert(payments)
            .values({
              reservationId: reservation.id,
              methodId: method.id,
              amount: request.body.amount,
              idempotencyKey,
              status: "succeeded",
              paidAt: new Date(),
              recordedByUserId: request.authUser!.id,
              notes,
            })
            .returning();

          const paidAmount = financials.netPaidAmount + payment.amount;
          const paymentStatus = paidAmount === bookingTotal ? "paid" : "partial";
          await tx
            .update(reservations)
            .set({
              paymentStatus,
              version: sql`${reservations.version} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(reservations.id, reservation.id));

          await recordReservationEvent(tx, {
            reservationId: reservation.id,
            eventType: "payment.recorded",
            actorType: "user",
            actorUserId: request.authUser!.id,
            reservationStatusBefore: reservation.reservationStatus,
            reservationStatusAfter: reservation.reservationStatus,
            paymentStatusBefore: reservation.paymentStatus,
            paymentStatusAfter: paymentStatus,
            referenceId: payment.id,
            details: {
              amount: payment.amount,
              methodId: method.id,
              remainingBalanceBefore: remainingBefore,
              remainingBalanceAfter: bookingTotal - paidAmount,
            },
          });

          return {
            replayed: false,
            result: {
              payment: { ...payment, method },
              bookingTotal,
              paidAmount,
              remainingBalance: bookingTotal - paidAmount,
              paymentStatus,
              reservationStatus: reservation.reservationStatus,
            },
          };
        });
        return reply
          .code(outcome.replayed ? 200 : 201)
          .send({ ...outcome.result, replayed: outcome.replayed });
      } catch (error) {
        if (error instanceof PaymentInputError) {
          return reply.code(error.statusCode).send({
            error: { code: error.code, message: error.message },
          });
        }
        throw error;
      }
    },
  );
};
