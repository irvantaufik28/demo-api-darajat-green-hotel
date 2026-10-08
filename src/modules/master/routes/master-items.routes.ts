import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { masterItems } from "../../../db/schema/master_items.schema.js";
import { masterIconKeys } from "../master-icons.js";
import {
  categorySlugs,
  codeForName,
  databaseErrorCode,
  masterCategories,
  sortOrderSchema,
  uuidSchema,
  type MasterCategorySlug,
} from "../master.shared.js";

type CategoryParams = { category: MasterCategorySlug };
type ItemParams = CategoryParams & { id: string };
type CreateBody = { name: string; iconKey?: string | null; sortOrder?: number };
type UpdateBody = { name?: string; iconKey?: string | null; sortOrder?: number; isActive?: boolean };

const categoryParamsSchema = {
  type: "object",
  required: ["category"],
  properties: { category: { type: "string", enum: categorySlugs } },
};

const itemParamsSchema = {
  type: "object",
  required: ["category", "id"],
  properties: {
    category: { type: "string", enum: categorySlugs },
    id: uuidSchema,
  },
};

const itemFields = {
  id: masterItems.id,
  code: masterItems.code,
  name: masterItems.name,
  iconKey: masterItems.iconKey,
  sortOrder: masterItems.sortOrder,
  isActive: masterItems.isActive,
};

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export const masterItemRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: CategoryParams }>(
    "/:category",
    {
      preHandler: app.requirePermission("master.view"),
      schema: { params: categoryParamsSchema },
    },
    async (request) => {
      const category = masterCategories[request.params.category];
      const items = await app.db
        .select(itemFields)
        .from(masterItems)
        .where(eq(masterItems.category, category))
        .orderBy(asc(masterItems.sortOrder), asc(masterItems.name));
      return { category: request.params.category, items };
    },
  );

  app.post<{ Params: CategoryParams; Body: CreateBody }>(
    "/:category",
    {
      preHandler: app.requirePermission("master.create"),
      schema: {
        params: categoryParamsSchema,
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 160 },
            iconKey: { anyOf: [{ type: "string", enum: masterIconKeys }, { type: "null" }] },
            sortOrder: sortOrderSchema,
          },
        },
      },
    },
    async (request, reply) => {
      const name = request.body.name.trim();
      const code = codeForName(name);
      if (!name || !code || code.length > 80) {
        return reply.code(400).send(errorBody("INVALID_NAME", "Invalid master item name"));
      }

      try {
        const [item] = await app.db
          .insert(masterItems)
          .values({
            category: masterCategories[request.params.category],
            code,
            name,
            iconKey: request.body.iconKey ?? null,
            sortOrder: request.body.sortOrder ?? 0,
          })
          .returning(itemFields);
        return reply.code(201).send({ item });
      } catch (error) {
        if (databaseErrorCode(error) === "23505") {
          return reply.code(409).send(errorBody("DUPLICATE_ITEM", "Master item already exists"));
        }
        throw error;
      }
    },
  );

  app.patch<{ Params: ItemParams; Body: UpdateBody }>(
    "/:category/:id",
    {
      preHandler: app.requirePermission("master.edit"),
      schema: {
        params: itemParamsSchema,
        body: {
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 160 },
            iconKey: { anyOf: [{ type: "string", enum: masterIconKeys }, { type: "null" }] },
            sortOrder: sortOrderSchema,
            isActive: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const name = request.body.name?.trim();
      if (name !== undefined && !name) {
        return reply.code(400).send(errorBody("INVALID_NAME", "Name must not be empty"));
      }
      if (name !== undefined) {
        const [duplicate] = await app.db
          .select({ id: masterItems.id })
          .from(masterItems)
          .where(
            and(
              eq(masterItems.category, masterCategories[request.params.category]),
              ne(masterItems.id, request.params.id),
              sql`lower(${masterItems.name}) = ${name.toLowerCase()}`,
            ),
          )
          .limit(1);
        if (duplicate) {
          return reply.code(409).send(errorBody("DUPLICATE_ITEM", "Master item already exists"));
        }
      }

      const [item] = await app.db
        .update(masterItems)
        .set({
          ...(name !== undefined ? { name } : {}),
          ...(request.body.iconKey !== undefined ? { iconKey: request.body.iconKey } : {}),
          ...(request.body.sortOrder !== undefined ? { sortOrder: request.body.sortOrder } : {}),
          ...(request.body.isActive !== undefined ? { isActive: request.body.isActive } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(masterItems.id, request.params.id),
            eq(masterItems.category, masterCategories[request.params.category]),
          ),
        )
        .returning(itemFields);
      if (!item) return reply.code(404).send(errorBody("NOT_FOUND", "Master item not found"));
      return { item };
    },
  );

  app.delete<{ Params: ItemParams }>(
    "/:category/:id",
    {
      preHandler: app.requirePermission("master.delete"),
      schema: { params: itemParamsSchema },
    },
    async (request, reply) => {
      try {
        const [deleted] = await app.db
          .delete(masterItems)
          .where(
            and(
              eq(masterItems.id, request.params.id),
              eq(masterItems.category, masterCategories[request.params.category]),
            ),
          )
          .returning({ id: masterItems.id });
        if (!deleted) return reply.code(404).send(errorBody("NOT_FOUND", "Master item not found"));
        return reply.code(204).send();
      } catch (error) {
        if (databaseErrorCode(error) === "23503") {
          return reply.code(409).send(errorBody("ITEM_IN_USE", "Master item is in use"));
        }
        throw error;
      }
    },
  );
};
