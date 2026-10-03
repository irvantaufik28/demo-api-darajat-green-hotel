import { asc, count, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { reservationEvents } from "../../../db/schema/reservation_events.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { users } from "../../../db/schema/users.schema.js";

type HistoryParams = { id: string };
type HistoryQuery = { page?: number; limit?: number };

const paramsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
} as const;

const querySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "integer", minimum: 1, default: 1 },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
  },
} as const;

export const reservationHistoryRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: HistoryParams; Querystring: HistoryQuery }>(
    "/:id/history",
    {
      preHandler: app.requirePermission("reservations.view"),
      schema: { params: paramsSchema, querystring: querySchema },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { page = 1, limit = 50 } = request.query;
      const [reservation] = await app.db
        .select({ id: reservations.id })
        .from(reservations)
        .where(eq(reservations.id, id))
        .limit(1);

      if (!reservation) {
        return reply.code(404).send({
          error: { code: "RESERVATION_NOT_FOUND", message: "Reservation not found" },
        });
      }

      const [events, [total]] = await Promise.all([
        app.db
          .select({
            event: reservationEvents,
            actor: {
              id: users.id,
              name: users.name,
            },
          })
          .from(reservationEvents)
          .leftJoin(users, eq(reservationEvents.actorUserId, users.id))
          .where(eq(reservationEvents.reservationId, id))
          .orderBy(asc(reservationEvents.sequence))
          .limit(limit)
          .offset((page - 1) * limit),
        app.db
          .select({ value: count() })
          .from(reservationEvents)
          .where(eq(reservationEvents.reservationId, id)),
      ]);

      return {
        reservationId: id,
        items: events.map(({ event, actor }) => ({ ...event, actor })),
        page,
        limit,
        total: total.value,
      };
    },
  );
};
