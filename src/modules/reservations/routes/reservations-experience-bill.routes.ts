import type { FastifyPluginAsync } from "fastify";
import { uuidSchema } from "../../master/master.shared.js";
import { ExperienceBillError, quoteExperienceBill, saveExperienceBill, type BillItem } from "../services/reservation-experience-bill.service.js";

type Params = { id: string };
type QuoteBody = { items: BillItem[] };
type SaveBody = QuoteBody & { expectedVersion: number; expectedAddedTotal: number };

const params = { type: "object", required: ["id"], properties: { id: uuidSchema } } as const;
const items = { type: "array", minItems: 1, maxItems: 30, items: {
  type: "object", additionalProperties: false, required: ["variantId", "quantity"],
  properties: {
    variantId: uuidSchema,
    quantity: { type: "integer", minimum: 1, maximum: 100 },
    serviceDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
  },
} } as const;

export const reservationExperienceBillRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: Params; Body: QuoteBody }>("/:id/experience-bill/quote", {
    preHandler: app.requirePermission("reservations.add_experience"),
    schema: { params, body: { type: "object", additionalProperties: false, required: ["items"], properties: { items } } },
  }, async (request, reply) => {
    try {
      return await quoteExperienceBill(app.db, request.params.id, request.body.items);
    } catch (error) {
      if (error instanceof ExperienceBillError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      throw error;
    }
  });

  app.post<{ Params: Params; Body: SaveBody }>("/:id/experience-bill", {
    preHandler: app.requirePermission("reservations.add_experience"),
    schema: { params, body: { type: "object", additionalProperties: false, required: ["items", "expectedVersion", "expectedAddedTotal"], properties: { items, expectedVersion: { type: "integer", minimum: 1 }, expectedAddedTotal: { type: "integer", minimum: 0 } } } },
  }, async (request, reply) => {
    try {
      return await app.db.transaction((tx) => saveExperienceBill(tx, {
        reservationId: request.params.id, expectedVersion: request.body.expectedVersion, expectedAddedTotal: request.body.expectedAddedTotal,
        items: request.body.items, actorUserId: request.authUser!.id,
      }));
    } catch (error) {
      if (error instanceof ExperienceBillError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      throw error;
    }
  });
};
