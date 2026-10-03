import { and, eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { paymentRefunds } from "../../../db/schema/payment_refunds.schema.js";
import { payments } from "../../../db/schema/payments.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { uuidSchema } from "../../master/master.shared.js";
import { calculateCancellationSettlement } from "../services/reservation-cancellation-settlement.service.js";
import { recordReservationEvent } from "../services/reservation-events.service.js";
import { readReservationFinancials } from "../services/reservation-financials.service.js";

type RefundParams = { id: string };
type RefundBody = {
  paymentId: string;
  amount: number;
  reason: string;
  reference: string;
  settlementOverrideReason?: string;
};

const paramsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: uuidSchema },
} as const;

const bodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["paymentId", "amount", "reason", "reference"],
  properties: {
    paymentId: uuidSchema,
    amount: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    reason: { type: "string", minLength: 1, maxLength: 2000 },
    reference: { type: "string", minLength: 1, maxLength: 160 },
    settlementOverrideReason: { type: "string", minLength: 1, maxLength: 2000 },
  },
} as const;

class RefundInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
  }
}

export const reservationRefundRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: RefundParams; Body: RefundBody }>(
    "/:id/refunds",
    {
      preHandler: app.requirePermission("payments.refund"),
      schema: { params: paramsSchema, body: bodySchema },
    },
    async (request, reply) => {
      const reason = request.body.reason.trim();
      const reference = request.body.reference.trim();
      if (!reason || !reference) {
        return reply.code(400).send({
          error: {
            code: "INVALID_REFUND_DETAILS",
            message: "Reason and refund reference are required",
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
            throw new RefundInputError("RESERVATION_NOT_FOUND", "Reservation not found", 404);
          }
          if (reservation.reservationStatus !== "cancelled") {
            throw new RefundInputError(
              "REFUND_NOT_ALLOWED",
              "Reservation must be cancelled before recording a cancellation refund",
            );
          }

          const [payment] = await tx
            .select()
            .from(payments)
            .where(
              and(
                eq(payments.id, request.body.paymentId),
                eq(payments.reservationId, reservation.id),
              ),
            )
            .for("update")
            .limit(1);
          if (!payment) {
            throw new RefundInputError(
              "PAYMENT_NOT_FOUND",
              "Payment not found for this reservation",
              404,
            );
          }
          if (!["succeeded", "partially_refunded"].includes(payment.status)) {
            throw new RefundInputError("PAYMENT_NOT_REFUNDABLE", "Payment is not refundable");
          }

          const settlement = await calculateCancellationSettlement(tx, reservation);
          const financials = await readReservationFinancials(tx, reservation.id);
          const existingRefunds = financials.refunds;
          const paymentRefundsSoFar = existingRefunds.filter(
            (item) => item.paymentId === payment.id,
          );
          if (paymentRefundsSoFar.some((item) => item.providerReference === reference)) {
            throw new RefundInputError(
              "DUPLICATE_REFUND_REFERENCE",
              "This refund reference has already been recorded for the payment",
            );
          }
          const completedForPayment = paymentRefundsSoFar.reduce(
            (sum, item) => sum + (item.status === "succeeded" ? item.amount : 0),
            0,
          );
          const reservedForPayment = paymentRefundsSoFar.reduce(
            (sum, item) => sum + (item.status === "pending" ? item.amount : 0),
            0,
          );
          if (request.body.amount > payment.amount - completedForPayment - reservedForPayment) {
            throw new RefundInputError(
              "REFUND_AMOUNT_EXCEEDED",
              "Refund amount exceeds the unrefunded payment balance",
            );
          }
          const settlementOverrideReason = request.body.settlementOverrideReason?.trim();
          if (settlement.calculationStatus === "manual_review_required") {
            if (!settlementOverrideReason) {
              throw new RefundInputError(
                "SETTLEMENT_REVIEW_REQUIRED",
                "Review the cancellation settlement and provide settlementOverrideReason",
              );
            }
          } else if (request.body.amount > (settlement.amounts.estimatedRefundAmount ?? 0)) {
            throw new RefundInputError(
              "REFUND_EXCEEDS_SETTLEMENT",
              "Refund amount exceeds the remaining cancellation settlement refund",
            );
          }

          const processedAt = new Date();
          const [refund] = await tx
            .insert(paymentRefunds)
            .values({
              paymentId: payment.id,
              amount: request.body.amount,
              reason,
              status: "succeeded",
              providerReference: reference,
              processedByUserId: request.authUser!.id,
              processedAt,
            })
            .returning();

          const refundedForPayment = completedForPayment + refund.amount;
          const paymentStatus =
            refundedForPayment === payment.amount ? "refunded" : "partially_refunded";
          await tx
            .update(payments)
            .set({
              status: paymentStatus,
              version: sql`${payments.version} + 1`,
              updatedAt: processedAt,
            })
            .where(eq(payments.id, payment.id));

          const netPaidAmount = financials.netPaidAmount - refund.amount;
          const reservationPaymentStatus =
            financials.grossPaidAmount > 0 && netPaidAmount === 0
              ? "refunded"
              : reservation.paymentStatus;
          await tx
            .update(reservations)
            .set({
              paymentStatus: reservationPaymentStatus,
              version: sql`${reservations.version} + 1`,
              updatedAt: processedAt,
            })
            .where(eq(reservations.id, reservation.id));

          await recordReservationEvent(tx, {
            reservationId: reservation.id,
            eventType: "payment.refunded",
            actorType: "user",
            actorUserId: request.authUser!.id,
            occurredAt: processedAt,
            reservationStatusBefore: reservation.reservationStatus,
            reservationStatusAfter: reservation.reservationStatus,
            paymentStatusBefore: reservation.paymentStatus,
            paymentStatusAfter: reservationPaymentStatus,
            referenceId: refund.id,
            details: {
              paymentId: payment.id,
              amount: refund.amount,
              reason,
              reference,
              settlementCalculationStatus: settlement.calculationStatus,
              settlementOverrideReason: settlementOverrideReason ?? null,
              settlementReviewReasons: settlement.reviewReasons,
              estimatedRefundAmountBefore: settlement.amounts.estimatedRefundAmount,
              paymentRefundedAmount: refundedForPayment,
              netPaidAmount,
            },
          });

          return {
            refund,
            paymentStatus,
            reservationPaymentStatus,
            paymentRefundableRemaining: payment.amount - refundedForPayment - reservedForPayment,
            netPaidAmount,
          };
        });
        return reply.code(201).send(result);
      } catch (error) {
        if (error instanceof RefundInputError) {
          return reply.code(error.statusCode).send({
            error: { code: error.code, message: error.message },
          });
        }
        throw error;
      }
    },
  );
};
