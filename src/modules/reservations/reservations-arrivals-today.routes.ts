import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { guests } from "../../db/schema/guests.schema.js";
import { masterItems } from "../../db/schema/master_items.schema.js";
import { reservationRooms } from "../../db/schema/reservation_rooms.schema.js";
import { reservations } from "../../db/schema/reservations.schema.js";
import { roomUnits } from "../../db/schema/room_units.schema.js";
import { bookingDateJakarta } from "./reservations-campaigns.service.js";

type ArrivalsQuery = {
  search?: string;
  source?: "website" | "phone" | "walk_in" | "ota";
  page?: number;
  limit?: number;
};

const querySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    search: { type: "string", maxLength: 255 },
    source: { type: "string", enum: ["website", "phone", "walk_in", "ota"] },
    page: { type: "integer", minimum: 1, default: 1 },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
  },
} as const;

const arrivalStatuses = ["pending", "confirmed", "checked_in"] as const;

function operationalStatus(status: (typeof reservations.$inferSelect)["reservationStatus"]) {
  if (status === "pending") {
    return { code: "awaiting_confirmation", label: "Awaiting Confirmation" };
  }
  if (status === "confirmed") {
    return { code: "ready_to_check_in", label: "Ready to Check-in" };
  }
  if (status === "checked_in") {
    return { code: "checked_in", label: "Checked In" };
  }
  throw new Error(`Unexpected arrival status: ${status}`);
}

export const reservationArrivalsTodayRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ArrivalsQuery }>(
    "/arrivals-today",
    {
      preHandler: app.requirePermission("reservations.view_arrivals_today"),
      schema: { querystring: querySchema },
    },
    async (request) => {
      const today = bookingDateJakarta();
      const { source, page = 1, limit = 20 } = request.query;
      const search = request.query.search?.trim();
      const filter = and(
        eq(reservations.checkInDate, today),
        inArray(reservations.reservationStatus, arrivalStatuses),
        source ? eq(reservations.source, source) : undefined,
        search
          ? or(
              ilike(reservations.bookingCode, `%${search}%`),
              ilike(guests.fullName, `%${search}%`),
              ilike(guests.phone, `%${search}%`),
            )
          : undefined,
      );

      const [rows, [{ total }]] = await Promise.all([
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
            otaChannel: {
              id: masterItems.id,
              code: masterItems.code,
              name: masterItems.name,
            },
          })
          .from(reservations)
          .innerJoin(guests, eq(reservations.guestId, guests.id))
          .leftJoin(masterItems, eq(reservations.otaChannelId, masterItems.id))
          .where(filter)
          .orderBy(
            sql`case ${reservations.reservationStatus} when 'confirmed' then 0 when 'pending' then 1 else 2 end`,
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
      ]);

      const reservationIds = rows.map((row) => row.id);
      const roomRows = reservationIds.length
        ? await app.db
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
            .orderBy(asc(reservationRooms.createdAt), asc(reservationRooms.id))
        : [];
      const roomsByReservation = new Map<string, typeof roomRows>();
      for (const room of roomRows) {
        const grouped = roomsByReservation.get(room.reservationId) ?? [];
        grouped.push(room);
        roomsByReservation.set(room.reservationId, grouped);
      }

      return {
        date: today,
        items: rows.map((row) => {
          const rooms = roomsByReservation.get(row.id) ?? [];
          const roomTypeCounts = new Map<string, number>();
          for (const room of rooms) {
            roomTypeCounts.set(room.roomTypeName, (roomTypeCounts.get(room.roomTypeName) ?? 0) + 1);
          }
          return {
            ...row,
            operationalStatus: operationalStatus(row.reservationStatus),
            rooms,
            roomCount: rooms.length,
            roomSummary: [...roomTypeCounts]
              .map(([name, quantity]) => (quantity > 1 ? `${quantity}× ${name}` : name))
              .join(", "),
          };
        }),
        page,
        limit,
        total,
      };
    },
  );
};
