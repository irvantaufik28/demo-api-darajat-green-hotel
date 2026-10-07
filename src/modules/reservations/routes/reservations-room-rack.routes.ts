import type { FastifyPluginAsync } from "fastify";
import type { RoomRackQuery } from "../schemas/reservations-room-rack.schema.js";
import { roomRackQuerySchema } from "../schemas/reservations-room-rack.schema.js";
import {
  readRoomRack,
  validRoomRackDate,
} from "../services/reservations-room-rack.service.js";

export const reservationRoomRackRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: RoomRackQuery }>(
    "/room-rack",
    {
      preHandler: app.requirePermission("reservations.view"),
      schema: { querystring: roomRackQuerySchema },
    },
    async (request, reply) => {
      if (!validRoomRackDate(request.query.startDate)) {
        return reply.code(400).send({
          error: { code: "INVALID_START_DATE", message: "Start date is invalid" },
        });
      }

      return readRoomRack(app.db, request.query);
    },
  );
};
