import { asc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { capacityPatterns } from "../../db/schema/capacity_patterns.schema.js";
import { roomTypeCapacityPatterns } from "../../db/schema/room_type_capacity_patterns.schema.js";
import { databaseErrorCode, sortOrderSchema, uuidSchema } from "./master.shared.js";

type PatternParams = { id: string };
type CreateBody = { adults: number; children: number; sortOrder?: number };
type UpdateBody = Partial<CreateBody> & { isActive?: boolean };

const countSchema = { type: "integer", minimum: 0, maximum: 99 } as const;
const paramsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: uuidSchema },
};
const patternFields = {
  id: capacityPatterns.id,
  adults: capacityPatterns.adults,
  children: capacityPatterns.children,
  sortOrder: capacityPatterns.sortOrder,
  isActive: capacityPatterns.isActive,
};

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export const capacityPatternRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: app.requirePermission("master.view") }, async () => {
    const items = await app.db
      .select(patternFields)
      .from(capacityPatterns)
      .orderBy(
        asc(capacityPatterns.sortOrder),
        asc(capacityPatterns.adults),
        asc(capacityPatterns.children),
      );
    return { items };
  });

  app.post<{ Body: CreateBody }>(
    "/",
    {
      preHandler: app.requirePermission("master.create"),
      schema: {
        body: {
          type: "object",
          required: ["adults", "children"],
          additionalProperties: false,
          properties: {
            adults: { ...countSchema, minimum: 1 },
            children: countSchema,
            sortOrder: sortOrderSchema,
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const [item] = await app.db
          .insert(capacityPatterns)
          .values({
            adults: request.body.adults,
            children: request.body.children,
            sortOrder: request.body.sortOrder ?? 0,
          })
          .returning(patternFields);
        return reply.code(201).send({ item });
      } catch (error) {
        if (databaseErrorCode(error) === "23505") {
          return reply
            .code(409)
            .send(errorBody("DUPLICATE_PATTERN", "Capacity pattern already exists"));
        }
        throw error;
      }
    },
  );

  app.patch<{ Params: PatternParams; Body: UpdateBody }>(
    "/:id",
    {
      preHandler: app.requirePermission("master.edit"),
      schema: {
        params: paramsSchema,
        body: {
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: {
            adults: { ...countSchema, minimum: 1 },
            children: countSchema,
            sortOrder: sortOrderSchema,
            isActive: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const [existing] = await app.db
        .select({ adults: capacityPatterns.adults, children: capacityPatterns.children })
        .from(capacityPatterns)
        .where(eq(capacityPatterns.id, request.params.id))
        .limit(1);
      if (!existing) return reply.code(404).send(errorBody("NOT_FOUND", "Pattern not found"));

      const changesCombination =
        (request.body.adults !== undefined && request.body.adults !== existing.adults) ||
        (request.body.children !== undefined && request.body.children !== existing.children);
      if (changesCombination) {
        const [usage] = await app.db
          .select({ roomTypeId: roomTypeCapacityPatterns.roomTypeId })
          .from(roomTypeCapacityPatterns)
          .where(eq(roomTypeCapacityPatterns.capacityPatternId, request.params.id))
          .limit(1);
        if (usage) {
          return reply
            .code(409)
            .send(errorBody("PATTERN_IN_USE", "Cannot change a pattern used by a room type"));
        }
      }

      try {
        const [item] = await app.db
          .update(capacityPatterns)
          .set({ ...request.body, updatedAt: new Date() })
          .where(eq(capacityPatterns.id, request.params.id))
          .returning(patternFields);
        if (!item) return reply.code(404).send(errorBody("NOT_FOUND", "Pattern not found"));
        return { item };
      } catch (error) {
        if (databaseErrorCode(error) === "23505") {
          return reply
            .code(409)
            .send(errorBody("DUPLICATE_PATTERN", "Capacity pattern already exists"));
        }
        throw error;
      }
    },
  );

  app.delete<{ Params: PatternParams }>(
    "/:id",
    {
      preHandler: app.requirePermission("master.delete"),
      schema: { params: paramsSchema },
    },
    async (request, reply) => {
      try {
        const [deleted] = await app.db
          .delete(capacityPatterns)
          .where(eq(capacityPatterns.id, request.params.id))
          .returning({ id: capacityPatterns.id });
        if (!deleted) return reply.code(404).send(errorBody("NOT_FOUND", "Pattern not found"));
        return reply.code(204).send();
      } catch (error) {
        if (databaseErrorCode(error) === "23503") {
          return reply.code(409).send(errorBody("PATTERN_IN_USE", "Pattern is in use"));
        }
        throw error;
      }
    },
  );
};
