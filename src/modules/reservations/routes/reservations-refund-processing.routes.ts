import { and, eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { paymentRefunds } from "../../../db/schema/payment_refunds.schema.js";
import { payments } from "../../../db/schema/payments.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { uuidSchema } from "../../master/master.shared.js";
import { calculateCancellationSettlement } from "../services/reservation-cancellation-settlement.service.js";
import { recordReservationEvent } from "../services/reservation-events.service.js";
import { readReservationFinancials } from "../services/reservation-financials.service.js";

type Params = { id: string };
type RefundParams = Params & { refundId: string };
type PrepareBody = {
  paymentId: string;
  amount: number;
  reason: string;
  ignoreCancellationPolicy?: boolean;
  settlementOverrideReason?: string;
};

const paramsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: uuidSchema },
} as const;
const refundParamsSchema = {
  type: "object",
  required: ["id", "refundId"],
  properties: { id: uuidSchema, refundId: uuidSchema },
} as const;
const prepareBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["paymentId", "amount", "reason"],
  properties: {
    paymentId: uuidSchema,
    amount: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    reason: { type: "string", minLength: 1, maxLength: 2000 },
    ignoreCancellationPolicy: { type: "boolean", default: false },
    settlementOverrideReason: { type: "string", minLength: 1, maxLength: 2000 },
  },
} as const;
const completeBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["reference"],
  properties: { reference: { type: "string", minLength: 1, maxLength: 160 } },
} as const;
const failBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["reason"],
  properties: { reason: { type: "string", minLength: 1, maxLength: 2000 } },
} as const;

class RefundOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
  }
}

export const reservationRefundProcessingRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: Params; Body: PrepareBody }>(
    "/:id/refunds/prepare",
    {
      preHandler: app.requirePermission("payments.refund"),
      schema: { params: paramsSchema, body: prepareBodySchema },
    },
    async (request, reply) => {
      try {
        const result = await app.db.transaction(async (tx) => {
          const [reservation] = await tx
            .select()
            .from(reservations)
            .where(eq(reservations.id, request.params.id))
            .for("update")
            .limit(1);
          if (!reservation)
            throw new RefundOperationError("RESERVATION_NOT_FOUND", "Reservation not found", 404);
          if (reservation.reservationStatus !== "cancelled") {
            throw new RefundOperationError(
              "REFUND_NOT_ALLOWED",
              "Reservation must be cancelled first",
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
          if (!payment || !["succeeded", "partially_refunded"].includes(payment.status)) {
            throw new RefundOperationError("PAYMENT_NOT_REFUNDABLE", "Payment is not refundable");
          }
          const reason = request.body.reason.trim();
          if (!reason)
            throw new RefundOperationError(
              "INVALID_REFUND_REASON",
              "Refund reason is required",
              400,
            );
          const [settlement, financials] = await Promise.all([
            calculateCancellationSettlement(tx, reservation),
            readReservationFinancials(tx, reservation.id),
          ]);
          const ownRefunds = financials.refunds.filter((refund) => refund.paymentId === payment.id);
          if (ownRefunds.some((refund) => refund.status === "pending")) {
            throw new RefundOperationError(
              "REFUND_ALREADY_PENDING",
              "Complete or fail the pending refund before starting another one for this payment",
            );
          }
          const completed = ownRefunds
            .filter((refund) => refund.status === "succeeded")
            .reduce((sum, refund) => sum + refund.amount, 0);
          const pending = ownRefunds
            .filter((refund) => refund.status === "pending")
            .reduce((sum, refund) => sum + refund.amount, 0);
          if (request.body.amount > payment.amount - completed - pending) {
            throw new RefundOperationError(
              "REFUND_AMOUNT_EXCEEDED",
              "Refund amount exceeds the unrefunded payment balance",
            );
          }
          const policyOverridden = request.body.ignoreCancellationPolicy === true;
          const overrideReason = request.body.settlementOverrideReason?.trim();
          if (
            (policyOverridden || settlement.calculationStatus === "manual_review_required") &&
            !overrideReason
          ) {
            throw new RefundOperationError(
              "SETTLEMENT_REVIEW_REQUIRED",
              "Settlement override reason is required",
            );
          }
          if (
            !policyOverridden &&
            settlement.calculationStatus === "calculated" &&
            request.body.amount >
              (settlement.amounts.estimatedRefundAmount ?? 0) - financials.pendingRefundAmount
          ) {
            throw new RefundOperationError(
              "REFUND_EXCEEDS_SETTLEMENT",
              "Refund amount exceeds the remaining cancellation settlement refund",
            );
          }
          const [refund] = await tx
            .insert(paymentRefunds)
            .values({
              paymentId: payment.id,
              amount: request.body.amount,
              reason,
              status: "pending",
            })
            .returning();
          await recordReservationEvent(tx, {
            reservationId: reservation.id,
            eventType: "payment.refund_pending",
            actorType: "user",
            actorUserId: request.authUser!.id,
            reservationStatusBefore: "cancelled",
            reservationStatusAfter: "cancelled",
            paymentStatusBefore: reservation.paymentStatus,
            paymentStatusAfter: reservation.paymentStatus,
            referenceId: refund.id,
            details: {
              paymentId: payment.id,
              amount: refund.amount,
              reason,
              cancellationPolicyOverridden: policyOverridden,
              settlementOverrideReason: overrideReason ?? null,
              cancellationPolicySnapshot: reservation.cancellationPolicySnapshot,
              estimatedRefundAmountBefore: settlement.amounts.estimatedRefundAmount,
            },
          });
          return {
            refund,
            reservationId: reservation.id,
            paymentStatus: reservation.paymentStatus,
          };
        });
        return reply.code(201).send(result);
      } catch (error) {
        if (error instanceof RefundOperationError)
          return reply
            .code(error.statusCode)
            .send({ error: { code: error.code, message: error.message } });
        throw error;
      }
    },
  );

  app.post<{ Params: RefundParams; Body: { reference: string } }>(
    "/:id/refunds/:refundId/complete",
    {
      preHandler: app.requirePermission("payments.refund"),
      schema: { params: refundParamsSchema, body: completeBodySchema },
    },
    async (request, reply) => {
      const reference = request.body.reference.trim();
      if (!reference)
        return reply.code(400).send({
          error: { code: "INVALID_REFUND_REFERENCE", message: "Refund reference is required" },
        });
      try {
        const result = await app.db.transaction(async (tx) => {
          const [reservation] = await tx
            .select()
            .from(reservations)
            .where(eq(reservations.id, request.params.id))
            .for("update")
            .limit(1);
          if (!reservation)
            throw new RefundOperationError("RESERVATION_NOT_FOUND", "Reservation not found", 404);
          if (reservation.reservationStatus !== "cancelled") {
            throw new RefundOperationError(
              "REFUND_NOT_ALLOWED",
              "Reservation must be cancelled first",
            );
          }
          const [refund] = await tx
            .select()
            .from(paymentRefunds)
            .where(eq(paymentRefunds.id, request.params.refundId))
            .for("update")
            .limit(1);
          if (!refund) throw new RefundOperationError("REFUND_NOT_FOUND", "Refund not found", 404);
          const [payment] = await tx
            .select()
            .from(payments)
            .where(
              and(eq(payments.id, refund.paymentId), eq(payments.reservationId, reservation.id)),
            )
            .for("update")
            .limit(1);
          if (!payment)
            throw new RefundOperationError(
              "REFUND_NOT_FOUND",
              "Refund not found for this reservation",
              404,
            );
          if (refund.status !== "pending")
            throw new RefundOperationError("REFUND_NOT_PENDING", "Refund is not pending");
          const financials = await readReservationFinancials(tx, reservation.id);
          if (
            financials.refunds.some(
              (item) =>
                item.paymentId === payment.id &&
                item.id !== refund.id &&
                item.providerReference === reference,
            )
          ) {
            throw new RefundOperationError(
              "DUPLICATE_REFUND_REFERENCE",
              "This refund reference has already been recorded",
            );
          }
          const completedForPayment = financials.refunds
            .filter((item) => item.paymentId === payment.id && item.status === "succeeded")
            .reduce((sum, item) => sum + item.amount, 0);
          const processedAt = new Date();
          const [completedRefund] = await tx
            .update(paymentRefunds)
            .set({
              status: "succeeded",
              providerReference: reference,
              processedByUserId: request.authUser!.id,
              processedAt,
            })
            .where(eq(paymentRefunds.id, refund.id))
            .returning();
          const paymentStatus =
            completedForPayment + refund.amount === payment.amount
              ? "refunded"
              : "partially_refunded";
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
            netPaidAmount === 0
              ? "refunded"
              : netPaidAmount < financials.bookingTotal
                ? "partial"
                : "paid";
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
            reservationStatusBefore: "cancelled",
            reservationStatusAfter: "cancelled",
            paymentStatusBefore: reservation.paymentStatus,
            paymentStatusAfter: reservationPaymentStatus,
            referenceId: refund.id,
            details: { paymentId: payment.id, amount: refund.amount, reference, netPaidAmount },
          });
          return {
            refund: completedRefund,
            paymentStatus,
            reservationPaymentStatus,
            netPaidAmount,
          };
        });
        return result;
      } catch (error) {
        if (error instanceof RefundOperationError)
          return reply
            .code(error.statusCode)
            .send({ error: { code: error.code, message: error.message } });
        throw error;
      }
    },
  );

  app.post<{ Params: RefundParams; Body: { reason: string } }>(
    "/:id/refunds/:refundId/fail",
    {
      preHandler: app.requirePermission("payments.refund"),
      schema: { params: refundParamsSchema, body: failBodySchema },
    },
    async (request, reply) => {
      const reason = request.body.reason.trim();
      if (!reason)
        return reply.code(400).send({
          error: { code: "INVALID_REFUND_REASON", message: "Failure reason is required" },
        });
      try {
        const result = await app.db.transaction(async (tx) => {
          const [reservation] = await tx
            .select()
            .from(reservations)
            .where(eq(reservations.id, request.params.id))
            .for("update")
            .limit(1);
          if (!reservation)
            throw new RefundOperationError("RESERVATION_NOT_FOUND", "Reservation not found", 404);
          const [refund] = await tx
            .select()
            .from(paymentRefunds)
            .where(eq(paymentRefunds.id, request.params.refundId))
            .for("update")
            .limit(1);
          if (!refund) throw new RefundOperationError("REFUND_NOT_FOUND", "Refund not found", 404);
          const [payment] = await tx
            .select({ reservationId: payments.reservationId })
            .from(payments)
            .where(eq(payments.id, refund.paymentId))
            .limit(1);
          if (!payment || payment.reservationId !== reservation.id) {
            throw new RefundOperationError(
              "REFUND_NOT_FOUND",
              "Refund not found for this reservation",
              404,
            );
          }
          if (refund.status !== "pending")
            throw new RefundOperationError("REFUND_NOT_PENDING", "Refund is not pending");
          const [failedRefund] = await tx
            .update(paymentRefunds)
            .set({ status: "failed" })
            .where(eq(paymentRefunds.id, refund.id))
            .returning();
          await recordReservationEvent(tx, {
            reservationId: reservation.id,
            eventType: "payment.refund_failed",
            actorType: "user",
            actorUserId: request.authUser!.id,
            reservationStatusBefore: reservation.reservationStatus,
            reservationStatusAfter: reservation.reservationStatus,
            paymentStatusBefore: reservation.paymentStatus,
            paymentStatusAfter: reservation.paymentStatus,
            referenceId: refund.id,
            details: { paymentId: refund.paymentId, amount: refund.amount, reason },
          });
          return { refund: failedRefund, reservationId: reservation.id };
        });
        return result;
      } catch (error) {
        if (error instanceof RefundOperationError)
          return reply
            .code(error.statusCode)
            .send({ error: { code: error.code, message: error.message } });
        throw error;
      }
    },
  );
};
