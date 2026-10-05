import type { FastifyPluginAsync } from "fastify";
import { uuidSchema } from "../../master/master.shared.js";
import {
  RoomOperationError,
  listChangeRoomOptions,
  quoteExtraBedChange,
  quoteRoomChange,
  saveExtraBedChange,
  saveRoomChange,
} from "../services/reservation-room-operations.service.js";

type Params = { id: string; roomId: string };
type RoomQuoteQuery = { targetRoomUnitId: string };
type BedQuoteQuery = { quantity: number };
type RoomChangeBody = RoomQuoteQuery & { expectedVersion: number };
type BedChangeBody = BedQuoteQuery & { expectedVersion: number };

const params = { type: "object", required: ["id", "roomId"], properties: { id: uuidSchema, roomId: uuidSchema } } as const;
const version = { type: "integer", minimum: 1 } as const;
const quantity = { type: "integer", minimum: 0, maximum: 20 } as const;

export const reservationRoomOperationRoutes: FastifyPluginAsync = async (app) => {
  const handle = async <T>(run: () => Promise<T>, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof RoomOperationError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      throw error;
    }
  };

  app.get<{ Params: Params }>("/:id/rooms/:roomId/change-options", {
    preHandler: app.requirePermission("reservations.change_room"), schema: { params },
  }, (request, reply) => handle(() => listChangeRoomOptions(app.db, request.params.id, request.params.roomId), reply));

  app.get<{ Params: Params; Querystring: RoomQuoteQuery }>("/:id/rooms/:roomId/change-room/quote", {
    preHandler: app.requirePermission("reservations.change_room"),
    schema: { params, querystring: { type: "object", additionalProperties: false, required: ["targetRoomUnitId"], properties: { targetRoomUnitId: uuidSchema } } },
  }, (request, reply) => handle(() => quoteRoomChange(app.db, request.params.id, request.params.roomId, request.query.targetRoomUnitId), reply));

  app.post<{ Params: Params; Body: RoomChangeBody }>("/:id/rooms/:roomId/change-room", {
    preHandler: app.requirePermission("reservations.change_room"),
    schema: { params, body: { type: "object", additionalProperties: false, required: ["targetRoomUnitId", "expectedVersion"], properties: { targetRoomUnitId: uuidSchema, expectedVersion: version } } },
  }, (request, reply) => handle(() => app.db.transaction((tx) => saveRoomChange(tx, { reservationId: request.params.id, roomId: request.params.roomId, ...request.body, actorUserId: request.authUser!.id })), reply));

  app.get<{ Params: Params; Querystring: BedQuoteQuery }>("/:id/rooms/:roomId/extra-beds/quote", {
    preHandler: app.requirePermission("reservations.manage_extra_bed"),
    schema: { params, querystring: { type: "object", additionalProperties: false, required: ["quantity"], properties: { quantity } } },
  }, (request, reply) => handle(() => quoteExtraBedChange(app.db, request.params.id, request.params.roomId, request.query.quantity), reply));

  app.post<{ Params: Params; Body: BedChangeBody }>("/:id/rooms/:roomId/extra-beds", {
    preHandler: app.requirePermission("reservations.manage_extra_bed"),
    schema: { params, body: { type: "object", additionalProperties: false, required: ["quantity", "expectedVersion"], properties: { quantity, expectedVersion: version } } },
  }, (request, reply) => handle(() => app.db.transaction((tx) => saveExtraBedChange(tx, { reservationId: request.params.id, roomId: request.params.roomId, ...request.body, actorUserId: request.authUser!.id })), reply));
};
