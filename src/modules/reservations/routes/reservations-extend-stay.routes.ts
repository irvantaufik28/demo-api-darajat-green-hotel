import type { FastifyPluginAsync } from "fastify";
import { uuidSchema } from "../../master/master.shared.js";
import { ExtendStayError, quoteExtendStay, saveExtendStay } from "../services/reservation-extend-stay.service.js";

type Params = { id: string };
type QuoteQuery = { newCheckOutDate: string };
type SaveBody = {
  newCheckOutDate: string;
  expectedVersion: number;
  payment?: { methodId: string; amount: number };
};

const dateSchema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;
const paramsSchema = { type: "object", required: ["id"], properties: { id: uuidSchema } } as const;

export const reservationExtendStayRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: Params; Querystring: QuoteQuery }>("/:id/extend-stay/quote", {
    preHandler: app.requirePermission("reservations.extend_stay"),
    schema: { params: paramsSchema, querystring: { type: "object", additionalProperties: false, required: ["newCheckOutDate"], properties: { newCheckOutDate: dateSchema } } },
  }, async (request, reply) => {
    try {
      return await quoteExtendStay(app.db, request.params.id, request.query.newCheckOutDate);
    } catch (error) {
      if (error instanceof ExtendStayError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      throw error;
    }
  });

  app.post<{ Params: Params; Body: SaveBody }>("/:id/extend-stay", {
    preHandler: app.requirePermission("reservations.extend_stay"),
    schema: { params: paramsSchema, body: { type: "object", additionalProperties: false, required: ["newCheckOutDate", "expectedVersion"], properties: {
      newCheckOutDate: dateSchema,
      expectedVersion: { type: "integer", minimum: 1 },
      payment: { type: "object", additionalProperties: false, required: ["methodId", "amount"], properties: { methodId: uuidSchema, amount: { type: "integer", minimum: 1 } } },
    } } },
  }, async (request, reply) => {
    try {
      return await app.db.transaction((tx) => saveExtendStay(tx, { reservationId: request.params.id, ...request.body, actorUserId: request.authUser!.id }));
    } catch (error) {
      if (error instanceof ExtendStayError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      throw error;
    }
  });
};
