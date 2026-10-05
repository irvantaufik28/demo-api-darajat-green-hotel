import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { guests } from "../../../db/schema/guests.schema.js";
import { masterItems } from "../../../db/schema/master_items.schema.js";
import { paymentRefunds } from "../../../db/schema/payment_refunds.schema.js";
import { payments } from "../../../db/schema/payments.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";

type Query = {
  search?: string;
  source?: "website" | "walk_in" | "phone" | "ota";
  status?: "pending" | "succeeded" | "failed" | "expired" | "refunded" | "partially_refunded";
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
    source: { type: "string", enum: ["website", "walk_in", "phone", "ota"] },
    status: {
      type: "string",
      enum: ["pending", "succeeded", "failed", "expired", "refunded", "partially_refunded"],
    },
    methodId: { type: "string", format: "uuid" },
    from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    page: { type: "integer", minimum: 1, default: 1 },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
  },
} as const;

export const paymentTransactionRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: Query }>(
    "/transactions",
    { preHandler: app.requirePermission("payments.view"), schema: { querystring: querySchema } },
    async (request, reply) => {
      const { search, source, status, methodId, from, to, page = 1, limit = 20 } = request.query;
      if (from && to && from > to) {
        return reply.code(400).send({
          error: { code: "INVALID_DATE_RANGE", message: "From date must not be after to date" },
        });
      }
      const term = search?.trim();
      const filter = and(
        term
          ? or(
              ilike(reservations.bookingCode, `%${term}%`),
              ilike(guests.fullName, `%${term}%`),
              ilike(guests.phone, `%${term}%`),
              ilike(payments.providerReference, `%${term}%`),
            )
          : undefined,
        source ? eq(reservations.source, source) : undefined,
        status ? eq(payments.status, status) : undefined,
        methodId ? eq(payments.methodId, methodId) : undefined,
        from
          ? sql`(${payments.createdAt} at time zone 'Asia/Jakarta')::date >= ${from}::date`
          : undefined,
        to
          ? sql`(${payments.createdAt} at time zone 'Asia/Jakarta')::date <= ${to}::date`
          : undefined,
      );
      const [items, [{ total }]] = await Promise.all([
        app.db
          .select({
            id: payments.id,
            reservationId: reservations.id,
            bookingCode: reservations.bookingCode,
            source: reservations.source,
            reservationStatus: reservations.reservationStatus,
            paymentStatus: reservations.paymentStatus,
            guest: { fullName: guests.fullName, phone: guests.phone },
            amount: payments.amount,
            status: payments.status,
            provider: payments.provider,
            providerReference: payments.providerReference,
            paidAt: payments.paidAt,
            createdAt: payments.createdAt,
            method: { id: masterItems.id, name: masterItems.name },
            refundedAmount: sql<number>`coalesce((
            select sum(r.amount) from ${paymentRefunds} r
            where r.payment_id = ${payments.id} and r.status = 'succeeded'
          ), 0)::bigint`.mapWith(Number),
            pendingRefundAmount: sql<number>`coalesce((
            select sum(r.amount) from ${paymentRefunds} r
            where r.payment_id = ${payments.id} and r.status = 'pending'
          ), 0)::bigint`.mapWith(Number),
          })
          .from(payments)
          .innerJoin(reservations, eq(payments.reservationId, reservations.id))
          .innerJoin(guests, eq(reservations.guestId, guests.id))
          .innerJoin(masterItems, eq(payments.methodId, masterItems.id))
          .where(filter)
          .orderBy(desc(payments.createdAt), desc(payments.id))
          .limit(limit)
          .offset((page - 1) * limit),
        app.db
          .select({ total: count() })
          .from(payments)
          .innerJoin(reservations, eq(payments.reservationId, reservations.id))
          .innerJoin(guests, eq(reservations.guestId, guests.id))
          .where(filter),
      ]);
      return { items, page, limit, total };
    },
  );
};
