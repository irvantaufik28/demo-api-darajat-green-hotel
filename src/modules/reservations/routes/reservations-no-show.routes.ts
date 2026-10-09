import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { reservationRooms } from "../../../db/schema/reservation_rooms.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { uuidSchema } from "../../master/master.shared.js";
import { recordReservationEvent } from "../services/reservation-events.service.js";
import { calculateNoShowSettlement } from "../services/reservation-no-show-settlement.service.js";

type Params = { id: string };
type Body = { reason: string };

const paramsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: uuidSchema },
} as const;

const bodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["reason"],
  properties: { reason: { type: "string", minLength: 1, maxLength: 2000 } },
} as const;

class NoShowInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
  }
}

function getJakartaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export const reservationNoShowRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: Params; Body: Body }>(
    "/:id/no-show",
    {
      preHandler: app.requirePermission("reservations.cancel"),
      schema: { params: paramsSchema, body: bodySchema },
    },
    async (request, reply) => {
      const reason = request.body.reason.trim();
      if (!reason) {
        return reply.code(400).send({
          error: { code: "INVALID_NO_SHOW_REASON", message: "No-show reason is required" },
        });
      }

      try {
        return await app.db.transaction(async (tx) => {
          const [reservation] = await tx
            .select()
            .from(reservations)
            .where(eq(reservations.id, request.params.id))
            .for("update")
            .limit(1);
          if (!reservation) {
            throw new NoShowInputError("RESERVATION_NOT_FOUND", "Reservation not found", 404);
          }
          if (reservation.reservationStatus !== "confirmed" || reservation.checkedInAt) {
            throw new NoShowInputError(
              "NO_SHOW_NOT_ALLOWED",
              "Only a confirmed reservation that has not checked in can be marked no-show",
            );
          }
          const [assignedRoom] = await tx
            .select({ id: reservationRooms.id })
            .from(reservationRooms)
            .where(
              and(
                eq(reservationRooms.reservationId, reservation.id),
                isNotNull(reservationRooms.roomUnitId),
              ),
            )
            .limit(1);
          if (assignedRoom) {
            throw new NoShowInputError(
              "NO_SHOW_ROOM_ASSIGNED",
              "Unassign the room before marking this reservation as no-show",
            );
          }
          if (reservation.checkInDate > getJakartaDate()) {
            throw new NoShowInputError(
              "NO_SHOW_TOO_EARLY",
              "Reservation can only be marked no-show on or after the check-in date",
            );
          }

          const settlement = await calculateNoShowSettlement(tx, reservation);
          const noShowAt = new Date();
          await tx
            .update(reservations)
            .set({
              reservationStatus: "no_show",
              noShowAt,
              noShowReason: reason,
              noShowMarkedByUserId: request.authUser!.id,
              noShowChargeAmount: settlement.amounts.noShowCharge,
              noShowSettlementSnapshot: settlement,
              version: sql`${reservations.version} + 1`,
              updatedAt: noShowAt,
            })
            .where(eq(reservations.id, reservation.id));

          await recordReservationEvent(tx, {
            reservationId: reservation.id,
            eventType: "reservation.no_show",
            actorType: "user",
            actorUserId: request.authUser!.id,
            occurredAt: noShowAt,
            reservationStatusBefore: "confirmed",
            reservationStatusAfter: "no_show",
            paymentStatusBefore: reservation.paymentStatus,
            paymentStatusAfter: reservation.paymentStatus,
            details: {
              reason,
              calculationStatus: settlement.calculationStatus,
              noShowCharge: settlement.amounts.noShowCharge,
              reviewReasons: settlement.reviewReasons,
              inventoryReleased: true,
            },
          });

          return {
            reservationId: reservation.id,
            bookingCode: reservation.bookingCode,
            reservationStatus: "no_show" as const,
            paymentStatus: reservation.paymentStatus,
            noShowAt,
            noShowReason: reason,
            inventoryReleased: true,
            settlement,
          };
        });
      } catch (error) {
        if (error instanceof NoShowInputError) {
          return reply
            .code(error.statusCode)
            .send({ error: { code: error.code, message: error.message } });
        }
        throw error;
      }
    },
  );
};
