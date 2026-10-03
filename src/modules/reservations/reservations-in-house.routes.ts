import { and, asc, count, desc, eq, gt, ilike, inArray, lt, or, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { guests } from "../../db/schema/guests.schema.js";
import { reservationDeposits } from "../../db/schema/reservation_deposits.schema.js";
import { reservationRooms } from "../../db/schema/reservation_rooms.schema.js";
import { reservations } from "../../db/schema/reservations.schema.js";
import { roomUnits } from "../../db/schema/room_units.schema.js";
import { bookingDateJakarta } from "./reservations-campaigns.service.js";

type InHouseQuery = {
  search?: string;
  operationalStatus?: "in_house" | "due_out" | "overdue";
  paymentStatus?: "unpaid" | "partial" | "paid";
  page?: number;
  limit?: number;
};

const querySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    search: { type: "string", maxLength: 255 },
    operationalStatus: { type: "string", enum: ["in_house", "due_out", "overdue"] },
    paymentStatus: { type: "string", enum: ["unpaid", "partial", "paid"] },
    page: { type: "integer", minimum: 1, default: 1 },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
  },
} as const;

function operationalStatus(checkOutDate: string, today: string) {
  if (checkOutDate < today) return { code: "overdue", label: "Overdue" };
  if (checkOutDate === today) return { code: "due_out", label: "Due Out" };
  return { code: "in_house", label: "In House" };
}

export const reservationInHouseRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: InHouseQuery }>(
    "/in-house",
    {
      preHandler: app.requirePermission("reservations.view_in_house"),
      schema: { querystring: querySchema },
    },
    async (request) => {
      const today = bookingDateJakarta();
      const {
        search,
        operationalStatus: statusFilter,
        paymentStatus,
        page = 1,
        limit = 20,
      } = request.query;
      const term = search?.trim();
      const pattern = `%${term}%`;
      const matchingRooms = app.db
        .select({ reservationId: reservationRooms.reservationId })
        .from(reservationRooms)
        .leftJoin(roomUnits, eq(reservationRooms.roomUnitId, roomUnits.id))
        .where(
          or(
            ilike(reservationRooms.roomTypeNameSnapshot, pattern),
            ilike(roomUnits.roomNumber, pattern),
          ),
        );
      const filter = and(
        eq(reservations.reservationStatus, "checked_in"),
        statusFilter === "in_house"
          ? gt(reservations.checkOutDate, today)
          : statusFilter === "due_out"
            ? eq(reservations.checkOutDate, today)
            : statusFilter === "overdue"
              ? lt(reservations.checkOutDate, today)
              : undefined,
        paymentStatus ? eq(reservations.paymentStatus, paymentStatus) : undefined,
        term
          ? or(
              ilike(reservations.bookingCode, pattern),
              ilike(guests.fullName, pattern),
              ilike(guests.phone, pattern),
              inArray(reservations.id, matchingRooms),
            )
          : undefined,
      );

      const [rows, [{ total }], [summary], [{ roomsOccupied }]] = await Promise.all([
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
            asc(reservations.checkOutDate),
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
          .select({
            guestsInHouse: count(),
            inHouse:
              sql<number>`count(*) filter (where ${reservations.checkOutDate} > ${today})::int`.mapWith(
                Number,
              ),
            dueOut:
              sql<number>`count(*) filter (where ${reservations.checkOutDate} = ${today})::int`.mapWith(
                Number,
              ),
            overdue:
              sql<number>`count(*) filter (where ${reservations.checkOutDate} < ${today})::int`.mapWith(
                Number,
              ),
          })
          .from(reservations)
          .where(eq(reservations.reservationStatus, "checked_in")),
        app.db
          .select({ roomsOccupied: count() })
          .from(reservationRooms)
          .innerJoin(reservations, eq(reservationRooms.reservationId, reservations.id))
          .where(eq(reservations.reservationStatus, "checked_in")),
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

      return {
        date: today,
        summary: { ...summary, roomsOccupied },
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
            operationalStatus: operationalStatus(row.checkOutDate, today),
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
              label: heldBalance > 0 ? "Held" : "No Deposit",
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
