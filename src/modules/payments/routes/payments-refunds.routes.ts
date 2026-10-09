import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { guests } from "../../../db/schema/guests.schema.js";
import { paymentRefunds } from "../../../db/schema/payment_refunds.schema.js";
import { payments } from "../../../db/schema/payments.schema.js";
import { reservationDeposits } from "../../../db/schema/reservation_deposits.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { readReservationFinancials } from "../../reservations/services/reservation-financials.service.js";
import { getNoRefundDecision } from "../../reservations/services/reservation-no-refund.service.js";
import { calculateRefundSettlement } from "../../reservations/services/reservation-refund-settlement.service.js";

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

const hasActiveDeposit = sql`exists (
  select 1 from ${reservationDeposits} d
  where d.reservation_id = ${reservations.id}
    and d.amount_held > d.amount_refunded + d.amount_deducted
)`;

const netPaid = sql`coalesce((
  select sum(p.amount) from ${payments} p
  where p.reservation_id = ${reservations.id}
    and p.status in ('succeeded', 'partially_refunded', 'refunded')
), 0) - coalesce((
  select sum(r.amount) from ${paymentRefunds} r
  join ${payments} p on p.id = r.payment_id
  where p.reservation_id = ${reservations.id} and r.status = 'succeeded'
), 0)`;

export const paymentRefundListRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: Query }>(
    "/refunds",
    { preHandler: app.requirePermission("payments.view"), schema: { querystring: querySchema } },
    async (request) => {
      const { search, source, page = 1, limit = 20 } = request.query;
      const term = search?.trim();
      const filter = and(
        or(
          and(eq(reservations.reservationStatus, "cancelled"), hasReceivedPayment),
          and(
            eq(reservations.reservationStatus, "no_show"),
            or(
              hasActiveDeposit,
              and(eq(reservations.source, "ota"), hasReceivedPayment),
              and(
                eq(reservations.source, "website"),
                sql`${reservations.paymentStatus} <> 'paid'`,
                hasReceivedPayment,
              ),
              sql`${netPaid} > coalesce(${reservations.noShowChargeAmount}, ${netPaid})`,
            ),
          ),
        ),
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
          .orderBy(
            desc(sql`coalesce(${reservations.noShowAt}, ${reservations.cancelledAt})`),
            desc(reservations.id),
          )
          .limit(limit)
          .offset((page - 1) * limit),
        app.db
          .select({ total: sql<number>`count(*)::int`.mapWith(Number) })
          .from(reservations)
          .innerJoin(guests, eq(reservations.guestId, guests.id))
          .where(filter),
      ]);
      const items = [];
      for (let offset = 0; offset < rows.length; offset += 2) {
        const batch = await Promise.all(
          rows.slice(offset, offset + 2).map(async ({ reservation, guest }) => {
            const financials = await readReservationFinancials(app.db, reservation.id);
            const noShow = reservation.reservationStatus === "no_show";
            const [settlement, noRefundDecision] = await Promise.all([
              calculateRefundSettlement(app.db, reservation, financials),
              getNoRefundDecision(app.db, reservation.id),
            ]);
            const estimatedRefundAmount = settlement.amounts.estimatedRefundAmount;
            const status = noRefundDecision
              ? "no_refund"
              : financials.pendingRefundAmount > 0
                ? "processing"
                : noShow && ((estimatedRefundAmount ?? 0) > 0 || financials.depositBalance > 0)
                  ? "action_required"
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
              reservationStatus: reservation.reservationStatus,
              guest,
              cancelledAt: reservation.cancelledAt,
              eventAt: reservation.noShowAt ?? reservation.cancelledAt,
              paymentStatus: reservation.paymentStatus,
              status,
              grossPaidAmount: financials.grossPaidAmount,
              refundedAmount: financials.refundedAmount,
              pendingRefundAmount: financials.pendingRefundAmount,
              netPaidAmount: financials.netPaidAmount,
              estimatedRefundAmount,
              depositBalance: financials.depositBalance,
              noShowPenaltyAmount: noShow ? settlement.amounts.cancellationCharge : null,
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
        items.push(...batch);
      }
      return { items, page, limit, total: summary.total };
    },
  );
};
