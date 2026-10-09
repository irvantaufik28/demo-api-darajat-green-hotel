import { and, count, desc, eq, gte, ilike, inArray, lte, or } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { guests } from "../../../db/schema/guests.schema.js";
import { masterItems } from "../../../db/schema/master_items.schema.js";
import { paymentRefunds } from "../../../db/schema/payment_refunds.schema.js";
import { payments } from "../../../db/schema/payments.schema.js";
import { reservationCharges } from "../../../db/schema/reservation_charges.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";

type Query = {
  search?: string;
  reservationStatus?:
    "pending" | "confirmed" | "checked_in" | "checked_out" | "no_show" | "cancelled" | "expired";
  paymentStatus?: "unpaid" | "partial" | "paid" | "failed" | "refunded" | "expired";
  source?: "website" | "walk_in" | "phone" | "ota";
  methodId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
};

const querySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    search: { type: "string", maxLength: 255 },
    reservationStatus: {
      type: "string",
      enum: [
        "pending",
        "confirmed",
        "checked_in",
        "checked_out",
        "no_show",
        "cancelled",
        "expired",
      ],
    },
    paymentStatus: {
      type: "string",
      enum: ["unpaid", "partial", "paid", "failed", "refunded", "expired"],
    },
    source: { type: "string", enum: ["website", "walk_in", "phone", "ota"] },
    methodId: { type: "string", format: "uuid" },
    from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    page: { type: "integer", minimum: 1, default: 1 },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
  },
} as const;

export const paymentListRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: Query }>(
    "/",
    {
      preHandler: app.requirePermission("payments.view"),
      schema: { querystring: querySchema },
    },
    async (request, reply) => {
      const {
        search,
        reservationStatus,
        paymentStatus,
        source,
        methodId,
        from,
        to,
        page = 1,
        limit = 20,
      } = request.query;
      if (from && to && from > to) {
        return reply.code(400).send({
          error: { code: "INVALID_DATE_RANGE", message: "From date must not be after to date" },
        });
      }
      const term = search?.trim();
      const matchingMethod = methodId
        ? app.db
            .select({ id: payments.reservationId })
            .from(payments)
            .where(eq(payments.methodId, methodId))
        : null;
      const filter = and(
        term
          ? or(
              ilike(reservations.bookingCode, `%${term}%`),
              ilike(guests.fullName, `%${term}%`),
              ilike(guests.phone, `%${term}%`),
            )
          : undefined,
        reservationStatus ? eq(reservations.reservationStatus, reservationStatus) : undefined,
        paymentStatus ? eq(reservations.paymentStatus, paymentStatus) : undefined,
        source ? eq(reservations.source, source) : undefined,
        matchingMethod ? inArray(reservations.id, matchingMethod) : undefined,
        from ? gte(reservations.checkInDate, from) : undefined,
        to ? lte(reservations.checkInDate, to) : undefined,
      );
      const [rows, [{ total }], methods] = await Promise.all([
        app.db
          .select({
            id: reservations.id,
            bookingCode: reservations.bookingCode,
            source: reservations.source,
            otaChannelId: reservations.otaChannelId,
            checkInDate: reservations.checkInDate,
            checkOutDate: reservations.checkOutDate,
            reservationStatus: reservations.reservationStatus,
            paymentStatus: reservations.paymentStatus,
            guest: { fullName: guests.fullName, phone: guests.phone },
          })
          .from(reservations)
          .innerJoin(guests, eq(reservations.guestId, guests.id))
          .where(filter)
          .orderBy(desc(reservations.createdAt), desc(reservations.id))
          .limit(limit)
          .offset((page - 1) * limit),
        app.db
          .select({ total: count() })
          .from(reservations)
          .innerJoin(guests, eq(reservations.guestId, guests.id))
          .where(filter),
        app.db
          .select({ id: masterItems.id, name: masterItems.name, category: masterItems.category })
          .from(masterItems)
          .where(inArray(masterItems.category, ["payment_methods", "ota_channels"])),
      ]);
      const ids = rows.map((row) => row.id);
      const [charges, paymentRows] = ids.length
        ? await Promise.all([
            app.db
              .select({
                reservationId: reservationCharges.reservationId,
                amount: reservationCharges.amount,
              })
              .from(reservationCharges)
              .where(inArray(reservationCharges.reservationId, ids)),
            app.db
              .select({
                id: payments.id,
                reservationId: payments.reservationId,
                amount: payments.amount,
                status: payments.status,
                methodId: payments.methodId,
              })
              .from(payments)
              .where(inArray(payments.reservationId, ids))
              .orderBy(desc(payments.paidAt), desc(payments.createdAt)),
          ])
        : [[], []];
      const paymentIds = paymentRows.map((row) => row.id);
      const refunds = paymentIds.length
        ? await app.db
            .select({
              paymentId: paymentRefunds.paymentId,
              amount: paymentRefunds.amount,
              status: paymentRefunds.status,
            })
            .from(paymentRefunds)
            .where(inArray(paymentRefunds.paymentId, paymentIds))
        : [];
      const names = new Map(methods.map((method) => [method.id, method.name]));
      return {
        items: rows.map((row) => {
          const bookingTotal = charges
            .filter((charge) => charge.reservationId === row.id)
            .reduce((sum, charge) => sum + charge.amount, 0);
          const ownPayments = paymentRows.filter((payment) => payment.reservationId === row.id);
          const succeeded = ownPayments.filter((payment) =>
            ["succeeded", "partially_refunded", "refunded"].includes(payment.status),
          );
          const paidAmount = succeeded.reduce((sum, payment) => sum + payment.amount, 0);
          const ownPaymentIds = new Set(ownPayments.map((payment) => payment.id));
          const refundedAmount = refunds
            .filter(
              (refund) => ownPaymentIds.has(refund.paymentId) && refund.status === "succeeded",
            )
            .reduce((sum, refund) => sum + refund.amount, 0);
          const method = succeeded[0]
            ? { id: succeeded[0].methodId, name: names.get(succeeded[0].methodId) ?? "—" }
            : null;
          return {
            ...row,
            otaChannel: row.otaChannelId ? (names.get(row.otaChannelId) ?? null) : null,
            bookingTotal,
            paidAmount,
            refundedAmount,
            remainingBalance: Math.max(0, bookingTotal - paidAmount + refundedAmount),
            method,
          };
        }),
        methods: methods
          .filter((method) => method.category === "payment_methods")
          .map(({ id, name }) => ({ id, name })),
        page,
        limit,
        total,
      };
    },
  );
};
