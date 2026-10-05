import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { guests } from "../../../db/schema/guests.schema.js";
import { payments } from "../../../db/schema/payments.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { calculateCancellationSettlement } from "../../reservations/services/reservation-cancellation-settlement.service.js";
import { readReservationFinancials } from "../../reservations/services/reservation-financials.service.js";

type Query = {
  search?: string;
  source?: "website" | "walk_in" | "phone" | "ota";
  page?: number;
  limit?: number;
};

const querySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    search: { type: "string", maxLength: 255 },
    source: { type: "string", enum: ["website", "walk_in", "phone", "ota"] },
    page: { type: "integer", minimum: 1, default: 1 },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
  },
} as const;

const hasReceivedPayment = sql`exists (
  select 1 from ${payments} p
  where p.reservation_id = ${reservations.id}
    and p.status in ('succeeded', 'partially_refunded', 'refunded')
)`;

export const paymentRefundListRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: Query }>(
    "/refunds",
    { preHandler: app.requirePermission("payments.view"), schema: { querystring: querySchema } },
    async (request) => {
      const { search, source, page = 1, limit = 20 } = request.query;
      const term = search?.trim();
      const filter = and(
        eq(reservations.reservationStatus, "cancelled"),
        hasReceivedPayment,
        source ? eq(reservations.source, source) : undefined,
        term
          ? or(
              ilike(reservations.bookingCode, `%${term}%`),
              ilike(guests.fullName, `%${term}%`),
              ilike(guests.phone, `%${term}%`),
            )
          : undefined,
      );
      const [rows, [summary]] = await Promise.all([
        app.db
          .select({
            reservation: reservations,
            guest: {
              fullName: guests.fullName,
              phone: guests.phone,
            },
          })
          .from(reservations)
          .innerJoin(guests, eq(reservations.guestId, guests.id))
          .where(filter)
          .orderBy(desc(reservations.cancelledAt), desc(reservations.id))
          .limit(limit)
          .offset((page - 1) * limit),
        app.db
          .select({ total: sql<number>`count(*)::int`.mapWith(Number) })
          .from(reservations)
          .innerJoin(guests, eq(reservations.guestId, guests.id))
          .where(filter),
      ]);
      const items = await Promise.all(
        rows.map(async ({ reservation, guest }) => {
          const [settlement, financials] = await Promise.all([
            calculateCancellationSettlement(app.db, reservation),
            readReservationFinancials(app.db, reservation.id),
          ]);
          const estimatedRefundAmount = settlement.amounts.estimatedRefundAmount;
          const status =
            financials.pendingRefundAmount > 0
              ? "processing"
              : financials.grossPaidAmount > 0 && financials.netPaidAmount === 0
                ? "completed"
                : settlement.calculationStatus === "manual_review_required"
                  ? "review_required"
                  : estimatedRefundAmount === 0 && financials.refundedAmount === 0
                    ? "no_refund_under_policy"
                    : estimatedRefundAmount === 0 && financials.refundedAmount > 0
                      ? "policy_settled"
                      : financials.refundedAmount > 0
                        ? "partially_refunded"
                        : "action_required";
          return {
            reservationId: reservation.id,
            bookingCode: reservation.bookingCode,
            source: reservation.source,
            guest,
            cancelledAt: reservation.cancelledAt,
            paymentStatus: reservation.paymentStatus,
            status,
            grossPaidAmount: financials.grossPaidAmount,
            refundedAmount: financials.refundedAmount,
            pendingRefundAmount: financials.pendingRefundAmount,
            netPaidAmount: financials.netPaidAmount,
            estimatedRefundAmount,
            maxRefundWithOverride: Math.max(
              0,
              financials.netPaidAmount - financials.pendingRefundAmount,
            ),
            settlementCalculationStatus: settlement.calculationStatus,
            policy: settlement.policy,
            reviewReasons: settlement.reviewReasons,
          };
        }),
      );
      return { items, page, limit, total: summary.total };
    },
  );
};
