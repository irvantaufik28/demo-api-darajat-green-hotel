import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { guests } from "../../../db/schema/guests.schema.js";
import { reservationCharges } from "../../../db/schema/reservation_charges.schema.js";
import { reservationRooms } from "../../../db/schema/reservation_rooms.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import {
  guestParamsSchema,
  guestUpdateBodySchema,
  type GuestUpdateBody,
} from "../schemas/guests.schema.js";

type IdParams = { id: string };
type ListQuery = {
  search?: string;
  status?: "active" | "blacklisted";
  page?: number;
  limit?: number;
};
type HistoryQuery = { page?: number; limit?: number };

const errorBody = (code: string, message: string) => ({ error: { code, message } });
const stayStatuses = sql`('checked_in', 'checked_out')`;
const outerGuestId = sql`${guests}.${sql.identifier("id")}`;
const outerGuestNik = sql`${guests}.${sql.identifier("nik")}`;
const outerReservationId = sql`${reservations}.${sql.identifier("id")}`;
const reservationMatchesGuestIdentity = sql`(
  (${outerGuestNik} is not null and exists (
    select 1 from ${guests} identity_guest
    where identity_guest.id = r.guest_id
      and identity_guest.nik = ${outerGuestNik}
  ))
  or (${outerGuestNik} is null and r.guest_id = ${outerGuestId})
)`;

const summaryColumns = {
  totalStays: sql<number>`(
    select count(*)::int from ${reservations} r
    where ${reservationMatchesGuestIdentity}
      and r.reservation_status in ${stayStatuses}
  )`,
  totalNights: sql<number>`(
    select coalesce(sum(r.check_out_date - r.check_in_date), 0)::int
    from ${reservations} r
    where ${reservationMatchesGuestIdentity}
      and r.reservation_status in ${stayStatuses}
  )`,
  totalSpend: sql<number>`(
    select coalesce(sum(c.amount), 0)::bigint
    from ${reservations} r
    join ${reservationCharges} c on c.reservation_id = r.id
    where ${reservationMatchesGuestIdentity}
      and r.reservation_status in ${stayStatuses}
  )`.mapWith(Number),
  lastStay: sql<string | null>`(
    select max(r.check_out_date)
    from ${reservations} r
    where ${reservationMatchesGuestIdentity}
      and r.reservation_status in ${stayStatuses}
  )`,
};

function guestColumns() {
  return {
    id: guests.id,
    fullName: guests.fullName,
    nik: guests.nik,
    phone: guests.phone,
    email: guests.email,
    nationality: guests.nationality,
    address: guests.address,
    internalNotes: guests.internalNotes,
    status: guests.status,
    createdAt: guests.createdAt,
    updatedAt: guests.updatedAt,
    ...summaryColumns,
  };
}

export const guestRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListQuery }>(
    "/",
    {
      preHandler: app.requirePermission("guests.view"),
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            search: { type: "string", maxLength: 255 },
            status: { type: "string", enum: ["active", "blacklisted"] },
            page: { type: "integer", minimum: 1, default: 1 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (request) => {
      const { search, status, page = 1, limit = 20 } = request.query;
      const term = search?.trim();
      const filter = and(
        term
          ? or(
              ilike(guests.fullName, `%${term}%`),
              ilike(guests.nik, `%${term}%`),
              ilike(guests.phone, `%${term}%`),
              ilike(guests.email, `%${term}%`),
            )
          : undefined,
        status ? eq(guests.status, status) : undefined,
      );
      const [items, [count]] = await Promise.all([
        app.db
          .select(guestColumns())
          .from(guests)
          .where(filter)
          .orderBy(asc(guests.fullName), asc(guests.id))
          .limit(limit)
          .offset((page - 1) * limit),
        app.db
          .select({ total: sql<number>`count(*)::int` })
          .from(guests)
          .where(filter),
      ]);
      return { items, page, limit, total: count.total };
    },
  );

  app.get<{ Params: IdParams }>(
    "/:id",
    {
      preHandler: [
        app.requirePermission("guests.view"),
        app.requirePermission("guests.view_stay_history"),
      ],
      schema: { params: guestParamsSchema },
    },
    async (request, reply) => {
      const [guest] = await app.db
        .select(guestColumns())
        .from(guests)
        .where(eq(guests.id, request.params.id))
        .limit(1);
      if (!guest) return reply.code(404).send(errorBody("NOT_FOUND", "Guest not found"));
      return { guest };
    },
  );

  app.get<{ Params: IdParams; Querystring: HistoryQuery }>(
    "/:id/reservations",
    {
      preHandler: app.requirePermission("guests.view_stay_history"),
      schema: {
        params: guestParamsSchema,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            page: { type: "integer", minimum: 1, default: 1 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (request, reply) => {
      const [guest] = await app.db
        .select({ id: guests.id, nik: guests.nik })
        .from(guests)
        .where(eq(guests.id, request.params.id))
        .limit(1);
      if (!guest) return reply.code(404).send(errorBody("NOT_FOUND", "Guest not found"));
      const { page = 1, limit = 20 } = request.query;
      const filter = guest.nik
        ? sql`${reservations.guestId} in (
            select identity_guest.id from ${guests} identity_guest
            where identity_guest.nik = ${guest.nik}
          )`
        : eq(reservations.guestId, guest.id);
      const [items, [count]] = await Promise.all([
        app.db
          .select({
            id: reservations.id,
            bookingCode: reservations.bookingCode,
            checkInDate: reservations.checkInDate,
            checkOutDate: reservations.checkOutDate,
            source: reservations.source,
            reservationStatus: reservations.reservationStatus,
            paymentStatus: reservations.paymentStatus,
            roomTypes: sql<string | null>`(
              select string_agg(distinct rr.room_type_name_snapshot, ', ')
              from ${reservationRooms} rr
              where rr.reservation_id = ${outerReservationId}
            )`,
            bookingTotal: sql<number>`(
              select coalesce(sum(c.amount), 0)::bigint
              from ${reservationCharges} c
              where c.reservation_id = ${outerReservationId}
            )`.mapWith(Number),
          })
          .from(reservations)
          .where(filter)
          .orderBy(desc(reservations.createdAt), desc(reservations.id))
          .limit(limit)
          .offset((page - 1) * limit),
        app.db
          .select({ total: sql<number>`count(*)::int` })
          .from(reservations)
          .where(filter),
      ]);
      return { items, page, limit, total: count.total };
    },
  );

  app.put<{ Params: IdParams; Body: GuestUpdateBody }>(
    "/:id",
    {
      preHandler: app.requirePermission("guests.edit"),
      schema: { params: guestParamsSchema, body: guestUpdateBodySchema },
    },
    async (request, reply) => {
      const fullName = request.body.fullName.trim();
      if (!fullName) {
        return reply.code(400).send(errorBody("INVALID_GUEST", "Guest name is required"));
      }
      const nullable = (value: string | null | undefined) => value?.trim() || null;
      const [updated] = await app.db
        .update(guests)
        .set({
          fullName,
          nik: nullable(request.body.nik),
          phone: nullable(request.body.phone),
          email: nullable(request.body.email),
          nationality: nullable(request.body.nationality),
          address: nullable(request.body.address),
          internalNotes: nullable(request.body.internalNotes),
          status: request.body.status,
          updatedAt: new Date(),
        })
        .where(eq(guests.id, request.params.id))
        .returning({ id: guests.id });
      if (!updated) return reply.code(404).send(errorBody("NOT_FOUND", "Guest not found"));
      const [guest] = await app.db
        .select(guestColumns())
        .from(guests)
        .where(eq(guests.id, updated.id))
        .limit(1);
      return { guest };
    },
  );
};
