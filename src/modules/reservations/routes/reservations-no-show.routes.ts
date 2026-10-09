import type { FastifyPluginAsync } from "fastify";
import { uuidSchema } from "../../master/master.shared.js";
import { markReservationNoShow, NoShowError } from "../services/reservation-no-show.service.js";

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
        return await app.db.transaction((tx) =>
          markReservationNoShow(tx, {
            reservationId: request.params.id,
            reason,
            actorType: "user",
            actorUserId: request.authUser!.id,
          }),
        );
      } catch (error) {
        if (error instanceof NoShowError) {
          return reply
            .code(error.statusCode)
            .send({ error: { code: error.code, message: error.message } });
        }
        throw error;
      }
    },
  );
};
