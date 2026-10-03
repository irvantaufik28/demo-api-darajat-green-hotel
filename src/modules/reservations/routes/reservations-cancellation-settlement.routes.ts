import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { uuidSchema } from "../../master/master.shared.js";
import { calculateCancellationSettlement } from "../services/reservation-cancellation-settlement.service.js";

type SettlementParams = { id: string };

const paramsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: uuidSchema },
} as const;

export const reservationCancellationSettlementRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: SettlementParams }>(
    "/:id/cancellation-settlement",
    {
      preHandler: app.requirePermission("payments.view"),
      schema: { params: paramsSchema },
    },
    async (request, reply) => {
      const [reservation] = await app.db
        .select()
        .from(reservations)
        .where(eq(reservations.id, request.params.id))
        .limit(1);
      if (!reservation) {
        return reply.code(404).send({
          error: { code: "RESERVATION_NOT_FOUND", message: "Reservation not found" },
        });
      }
      if (reservation.reservationStatus !== "cancelled" || !reservation.cancelledAt) {
        return reply.code(409).send({
          error: {
            code: "RESERVATION_NOT_CANCELLED",
            message: "Cancellation settlement is available after the reservation is cancelled",
          },
        });
      }
      return calculateCancellationSettlement(app.db, reservation);
    },
  );
};
