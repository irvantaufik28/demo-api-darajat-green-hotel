import { asc, eq, inArray } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { guests } from "../../../db/schema/guests.schema.js";
import { masterItems } from "../../../db/schema/master_items.schema.js";
import { reservationExperiences } from "../../../db/schema/reservation_experiences.schema.js";
import { reservationRoomExtraBeds } from "../../../db/schema/reservation_room_extra_beds.schema.js";
import { reservationRoomNights } from "../../../db/schema/reservation_room_nights.schema.js";
import { reservationRooms } from "../../../db/schema/reservation_rooms.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { roomUnits } from "../../../db/schema/room_units.schema.js";
import { readReservationFinancials } from "../services/reservation-financials.service.js";

const paramsSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", format: "uuid" },
  },
} as const;

export const reservationDetailRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>(
    "/:id",
    {
      preHandler: app.requirePermission("reservations.view"),
      schema: { params: paramsSchema },
    },
    async (request, reply) => {
      const [record] = await app.db
        .select({ reservation: reservations, guest: guests })
        .from(reservations)
        .innerJoin(guests, eq(reservations.guestId, guests.id))
        .where(eq(reservations.id, request.params.id))
        .limit(1);

      if (!record) {
        return reply.code(404).send({
          error: { code: "RESERVATION_NOT_FOUND", message: "Reservation not found" },
        });
      }

      const reservationId = record.reservation.id;
      const [roomRows, experiences, otaChannelRows, financials] = await Promise.all([
        app.db
          .select({ reservationRoom: reservationRooms, roomNumber: roomUnits.roomNumber })
          .from(reservationRooms)
          .leftJoin(roomUnits, eq(reservationRooms.roomUnitId, roomUnits.id))
          .where(eq(reservationRooms.reservationId, reservationId))
          .orderBy(asc(reservationRooms.createdAt), asc(reservationRooms.id)),
        app.db
          .select()
          .from(reservationExperiences)
          .where(eq(reservationExperiences.reservationId, reservationId))
          .orderBy(asc(reservationExperiences.createdAt), asc(reservationExperiences.id)),
        record.reservation.otaChannelId
          ? app.db
              .select()
              .from(masterItems)
              .where(eq(masterItems.id, record.reservation.otaChannelId))
              .limit(1)
          : Promise.resolve([]),
        readReservationFinancials(app.db, reservationId),
      ]);

      const roomIds = roomRows.map((row) => row.reservationRoom.id);
      const [nights, extraBeds] = roomIds.length
        ? await Promise.all([
            app.db
              .select()
              .from(reservationRoomNights)
              .where(inArray(reservationRoomNights.reservationRoomId, roomIds))
              .orderBy(asc(reservationRoomNights.stayDate)),
            app.db
              .select()
              .from(reservationRoomExtraBeds)
              .where(inArray(reservationRoomExtraBeds.reservationRoomId, roomIds))
              .orderBy(asc(reservationRoomExtraBeds.dateFrom)),
          ])
        : [[], []];
      const methodIds = [
        ...new Set([
          ...financials.payments.map((payment) => payment.methodId),
          ...financials.deposits
            .map((deposit) => deposit.methodId)
            .filter((id): id is string => Boolean(id)),
        ]),
      ];
      const methods = methodIds.length
        ? await app.db.select().from(masterItems).where(inArray(masterItems.id, methodIds))
        : [];
      const methodById = new Map(methods.map((method) => [method.id, method]));
      const appliedCampaigns = [
        ...new Map(
          nights
            .filter((night) => night.campaignSnapshot)
            .map((night) => [night.campaignSnapshot!.id, night.campaignSnapshot!]),
        ).values(),
      ];

      return {
        reservation: record.reservation,
        guest: record.guest,
        otaChannel: otaChannelRows[0] ?? null,
        rooms: roomRows.map(({ reservationRoom, roomNumber }) => ({
          ...reservationRoom,
          roomNumber,
          nights: nights.filter((night) => night.reservationRoomId === reservationRoom.id),
          extraBeds: extraBeds.filter((bed) => bed.reservationRoomId === reservationRoom.id),
        })),
        appliedCampaigns,
        experiences,
        charges: financials.charges,
        payments: financials.payments.map((payment) => ({
          ...payment,
          method: methodById.get(payment.methodId) ?? null,
        })),
        refunds: financials.refunds,
        deposits: financials.deposits.map((deposit) => ({
          ...deposit,
          method: deposit.methodId ? (methodById.get(deposit.methodId) ?? null) : null,
        })),
        summary: {
          roomCount: roomRows.length,
          nights: Math.round(
            (Date.parse(record.reservation.checkOutDate) -
              Date.parse(record.reservation.checkInDate)) /
              86_400_000,
          ),
          bookingTotal: financials.bookingTotal,
          grossPaidAmount: financials.grossPaidAmount,
          refundedAmount: financials.refundedAmount,
          paidAmount: financials.netPaidAmount,
          remainingBalance: financials.remainingBalance,
          depositBalance: financials.depositBalance,
        },
      };
    },
  );
};
