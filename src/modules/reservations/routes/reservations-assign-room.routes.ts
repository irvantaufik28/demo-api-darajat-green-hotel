import type { FastifyPluginAsync } from "fastify";
import {
  assignRoomBodySchema,
  assignRoomParamsSchema,
  type AssignRoomBody,
  type AssignRoomParams,
} from "../schemas/reservations-assign-room.schema.js";
import {
  assignReservationRoom,
  AssignRoomError,
  readReservationAssignmentOptions,
} from "../services/reservation-assign-room.service.js";

export const reservationAssignRoomRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: AssignRoomParams }>(
    "/:id/rooms/:roomId/assignment-options",
    {
      preHandler: app.requirePermission("reservations.assign_room"),
      schema: { params: assignRoomParamsSchema },
    },
    async (request, reply) => {
      try {
        return await readReservationAssignmentOptions(app.db, request.params);
      } catch (error) {
        if (error instanceof AssignRoomError) {
          return reply.code(error.statusCode).send({
            error: { code: error.code, message: error.message },
          });
        }
        throw error;
      }
    },
  );

  app.patch<{ Params: AssignRoomParams; Body: AssignRoomBody }>(
    "/:id/rooms/:roomId/assignment",
    {
      preHandler: app.requirePermission("reservations.assign_room"),
      schema: { params: assignRoomParamsSchema, body: assignRoomBodySchema },
    },
    async (request, reply) => {
      try {
        return await app.db.transaction((tx) =>
          assignReservationRoom(tx, request.params, request.body, request.authUser!.id),
        );
      } catch (error) {
        if (error instanceof AssignRoomError) {
          return reply.code(error.statusCode).send({
            error: { code: error.code, message: error.message },
          });
        }
        throw error;
      }
    },
  );
};
