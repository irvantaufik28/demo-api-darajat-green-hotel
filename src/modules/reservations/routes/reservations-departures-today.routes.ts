import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { guests } from "../../../db/schema/guests.schema.js";
import { reservationDeposits } from "../../../db/schema/reservation_deposits.schema.js";
import { reservationRooms } from "../../../db/schema/reservation_rooms.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { roomUnits } from "../../../db/schema/room_units.schema.js";
import { getCheckOutClock } from "../services/reservation-check-out-time.service.js";
import { resolveReservationOperationalStatus } from "../reservations-operational-status.js";

type DeparturesQuery = {
  search?: string;
  operationalStatus?: "due_out" | "overdue" | "checked_out";
  paymentStatus?: "unpaid" | "partial" | "paid";
  page?: number;
  limit?: number;
};

const querySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    search: { type: "string", maxLength: 255 },
    operationalStatus: { type: "string", enum: ["due_out", "overdue", "checked_out"] },
    paymentStatus: { type: "string", enum: ["unpaid", "partial", "paid"] },
    page: { type: "integer", minimum: 1, default: 1 },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
  },
} as const;

const departureStatuses = ["checked_in", "checked_out"] as const;

export const reservationDeparturesTodayRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: DeparturesQuery }>(
    "/departures-today",
    {
      preHandler: app.requirePermission("reservations.view_departures_today"),
      schema: { querystring: querySchema },
    },
    async (request) => {
      const clock = await getCheckOutClock(app.db);
      const today = clock.serverDate;
      const {
        search,
        operationalStatus: statusFilter,
        paymentStatus,
        page = 1,
        limit = 20,
      } = request.query;
      const term = search?.trim();
      const filter = and(
        eq(reservations.checkOutDate, today),
        inArray(reservations.reservationStatus, departureStatuses),
        statusFilter === "checked_out"
          ? eq(reservations.reservationStatus, "checked_out")
          : statusFilter === "due_out"
            ? clock.afterCheckOutTime
              ? sql`false`
              : eq(reservations.reservationStatus, "checked_in")
            : statusFilter === "overdue"
              ? clock.afterCheckOutTime
                ? eq(reservations.reservationStatus, "checked_in")
                : sql`false`
              : undefined,
        paymentStatus ? eq(reservations.paymentStatus, paymentStatus) : undefined,
        term
          ? or(
              ilike(reservations.bookingCode, `%${term}%`),
              ilike(guests.fullName, `%${term}%`),
              ilike(guests.phone, `%${term}%`),
            )
          : undefined,
      );

      const [rows, [{ total }], statusCounts] = await Promise.all([
        app.db
          .select({
            id: reservations.id,
            bookingCode: reservations.bookingCode,
            source: reservations.source,
            checkInDate: reservations.checkInDate,
            checkOutDate: reservations.checkOutDate,
            nights: sql<number>`${reservations.checkOutDate} - ${reservations.checkInDate}`,
            adults: reservations.adults,
            children: reservations.children,
            reservationStatus: reservations.reservationStatus,
            paymentStatus: reservations.paymentStatus,
            checkedInAt: reservations.checkedInAt,
            checkedOutAt: reservations.checkedOutAt,
            guest: {
              id: guests.id,
              fullName: guests.fullName,
              phone: guests.phone,
              email: guests.email,
            },
          })
          .from(reservations)
          .innerJoin(guests, eq(reservations.guestId, guests.id))
          .where(filter)
          .orderBy(
            sql`case ${reservations.reservationStatus} when 'checked_in' then 0 else 1 end`,
            desc(reservations.createdAt),
            desc(reservations.id),
          )
          .limit(limit)
          .offset((page - 1) * limit),
        app.db
          .select({ total: count() })
          .from(reservations)
          .innerJoin(guests, eq(reservations.guestId, guests.id))
          .where(filter),
        app.db
          .select({ reservationStatus: reservations.reservationStatus, total: count() })
          .from(reservations)
          .where(
            and(
              eq(reservations.checkOutDate, today),
              inArray(reservations.reservationStatus, departureStatuses),
            ),
          )
          .groupBy(reservations.reservationStatus),
      ]);

      const reservationIds = rows.map((row) => row.id);
      const [roomRows, depositRows] = reservationIds.length
        ? await Promise.all([
            app.db
              .select({
                id: reservationRooms.id,
                reservationId: reservationRooms.reservationId,
                roomTypeId: reservationRooms.roomTypeId,
                roomTypeName: reservationRooms.roomTypeNameSnapshot,
                roomUnitId: reservationRooms.roomUnitId,
                roomNumber: roomUnits.roomNumber,
              })
              .from(reservationRooms)
              .leftJoin(roomUnits, eq(reservationRooms.roomUnitId, roomUnits.id))
              .where(inArray(reservationRooms.reservationId, reservationIds))
              .orderBy(asc(reservationRooms.createdAt), asc(reservationRooms.id)),
            app.db
              .select({
                reservationId: reservationDeposits.reservationId,
                amountHeld: sql<number>`sum(${reservationDeposits.amountHeld})::bigint`.mapWith(
                  Number,
                ),
                amountRefunded:
                  sql<number>`sum(${reservationDeposits.amountRefunded})::bigint`.mapWith(Number),
                amountDeducted:
                  sql<number>`sum(${reservationDeposits.amountDeducted})::bigint`.mapWith(Number),
                heldBalance:
                  sql<number>`sum(${reservationDeposits.amountHeld} - ${reservationDeposits.amountRefunded} - ${reservationDeposits.amountDeducted})::bigint`.mapWith(
                    Number,
                  ),
              })
              .from(reservationDeposits)
              .where(inArray(reservationDeposits.reservationId, reservationIds))
              .groupBy(reservationDeposits.reservationId),
          ])
        : [[], []];
      const roomsByReservation = new Map<string, typeof roomRows>();
      for (const room of roomRows) {
        const grouped = roomsByReservation.get(room.reservationId) ?? [];
        grouped.push(room);
        roomsByReservation.set(room.reservationId, grouped);
      }
      const depositsByReservation = new Map(
        depositRows.map((deposit) => [deposit.reservationId, deposit]),
      );
      const checkedIn = statusCounts.find((row) => row.reservationStatus === "checked_in")?.total ?? 0;
      const dueOut = clock.afterCheckOutTime ? 0 : checkedIn;
      const overdue = clock.afterCheckOutTime ? checkedIn : 0;
      const checkedOut =
        statusCounts.find((row) => row.reservationStatus === "checked_out")?.total ?? 0;

      return {
        date: today,
        summary: { total: checkedIn + checkedOut, dueOut, overdue, checkedOut },
        items: rows.map((row) => {
          const rooms = roomsByReservation.get(row.id) ?? [];
          const roomTypeCounts = new Map<string, number>();
          for (const room of rooms) {
            roomTypeCounts.set(room.roomTypeName, (roomTypeCounts.get(room.roomTypeName) ?? 0) + 1);
          }
          const deposit = depositsByReservation.get(row.id);
          const heldBalance = deposit?.heldBalance ?? 0;
          return {
            ...row,
            operationalStatus: resolveReservationOperationalStatus(
              row.reservationStatus,
              row.checkInDate,
              row.checkOutDate,
              clock,
            ),
            rooms,
            roomCount: rooms.length,
            roomSummary: [...roomTypeCounts]
              .map(([name, quantity]) => (quantity > 1 ? `${quantity}× ${name}` : name))
              .join(", "),
            deposit: {
              amountHeld: deposit?.amountHeld ?? 0,
              amountRefunded: deposit?.amountRefunded ?? 0,
              amountDeducted: deposit?.amountDeducted ?? 0,
              heldBalance,
              label:
                heldBalance > 0
                  ? "Held"
                  : (deposit?.amountRefunded ?? 0) > 0
                    ? "Refunded"
                    : (deposit?.amountDeducted ?? 0) > 0
                      ? "Deducted"
                      : "No Deposit",
            },
          };
        }),
        page,
        limit,
        total,
      };
    },
  );
};
