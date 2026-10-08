import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { experienceVariants } from "../../../db/schema/experience_variants.schema.js";
import { experiences } from "../../../db/schema/experiences.schema.js";
import { masterItems } from "../../../db/schema/master_items.schema.js";
import { databaseErrorCode, uuidSchema } from "../../master/master.shared.js";
import {
  experienceBodySchema,
  experienceParamsSchema,
  type ExperienceBody,
} from "../schemas/experiences.schema.js";

type IdParams = { id: string };
type ListQuery = {
  search?: string;
  categoryId?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
};

const errorBody = (code: string, message: string) => ({ error: { code, message } });

function validateBody(body: ExperienceBody) {
  const variants = body.variants.map((variant) => ({
    subName: variant.subName.trim(),
    description: variant.description?.trim() || null,
    imageUrl: variant.imageUrl?.trim() || null,
    price: variant.price,
  }));
  if (!body.name.trim() || !body.code.trim() || !body.slug.trim()) {
    throw new Error("Experience name, code, and slug are required");
  }
  if (variants.some((variant) => !variant.subName)) {
    throw new Error("Every variant needs a sub name");
  }
  if (
    new Set(variants.map((variant) => variant.subName.toLocaleLowerCase())).size !== variants.length
  ) {
    throw new Error("Variant sub names must be unique within an experience");
  }
  return variants;
}

async function getDetail(app: Parameters<FastifyPluginAsync>[0], id: string) {
  const [row] = await app.db
    .select({
      experience: experiences,
      category: {
        id: masterItems.id,
        code: masterItems.code,
        name: masterItems.name,
        isActive: masterItems.isActive,
      },
    })
    .from(experiences)
    .innerJoin(masterItems, eq(experiences.categoryId, masterItems.id))
    .where(eq(experiences.id, id))
    .limit(1);
  if (!row) return null;
  const variants = await app.db
    .select()
    .from(experienceVariants)
    .where(eq(experienceVariants.experienceId, id))
    .orderBy(asc(experienceVariants.sortOrder));
  return { ...row.experience, category: row.category, variants };
}

async function validateCategory(
  app: Parameters<FastifyPluginAsync>[0],
  categoryId: string,
  allowInactive = false,
) {
  const [category] = await app.db
    .select({ id: masterItems.id })
    .from(masterItems)
    .where(
      and(
        eq(masterItems.id, categoryId),
        eq(masterItems.category, "experience_categories"),
        allowInactive ? undefined : eq(masterItems.isActive, true),
      ),
    )
    .limit(1);
  return Boolean(category);
}

function values(body: ExperienceBody, minPrice: number) {
  return {
    categoryId: body.categoryId,
    code: body.code.trim(),
    slug: body.slug.trim(),
    name: body.name.trim(),
    description: body.description?.trim() || null,
    price: minPrice,
    maxQuantity: body.maxQuantity,
    imageUrl: body.imageUrl?.trim() || null,
    coverImageUrl: body.coverImageUrl?.trim() || null,
    isActive: body.isActive,
  };
}

export const experienceRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListQuery }>(
    "/",
    {
      preHandler: app.requirePermission("experiences.view"),
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            search: { type: "string", maxLength: 160 },
            categoryId: uuidSchema,
            isActive: { type: "boolean" },
            page: { type: "integer", minimum: 1, default: 1 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (request) => {
      const { search, categoryId, isActive, page = 1, limit = 20 } = request.query;
      const filter = and(
        search?.trim()
          ? or(
              ilike(experiences.name, `%${search.trim()}%`),
              ilike(experiences.description, `%${search.trim()}%`),
            )
          : undefined,
        categoryId ? eq(experiences.categoryId, categoryId) : undefined,
        isActive === undefined ? undefined : eq(experiences.isActive, isActive),
      );
      const [items, [count]] = await Promise.all([
        app.db
          .select({
            experience: experiences,
            category: {
              id: masterItems.id,
              code: masterItems.code,
              name: masterItems.name,
              isActive: masterItems.isActive,
            },
          })
          .from(experiences)
          .innerJoin(masterItems, eq(experiences.categoryId, masterItems.id))
          .where(filter)
          .orderBy(desc(experiences.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        app.db
          .select({ total: sql<number>`count(*)::int` })
          .from(experiences)
          .where(filter),
      ]);
      const ids = items.map((item) => item.experience.id);
      const variants = ids.length
        ? await app.db
            .select()
            .from(experienceVariants)
            .where(inArray(experienceVariants.experienceId, ids))
            .orderBy(asc(experienceVariants.sortOrder))
        : [];
      return {
        items: items.map((item) => ({
          ...item.experience,
          category: item.category,
          variants: variants.filter((variant) => variant.experienceId === item.experience.id),
        })),
        page,
        limit,
        total: count.total,
      };
    },
  );

  app.get<{ Params: IdParams }>(
    "/:id",
    {
      preHandler: app.requirePermission("experiences.view"),
      schema: { params: experienceParamsSchema },
    },
    async (request, reply) => {
      const experience = await getDetail(app, request.params.id);
      if (!experience) return reply.code(404).send(errorBody("NOT_FOUND", "Experience not found"));
      return { experience };
    },
  );

  app.post<{ Body: ExperienceBody }>(
    "/",
    {
      preHandler: app.requirePermission("experiences.create"),
      schema: { body: experienceBodySchema },
    },
    async (request, reply) => {
      let variants;
      try {
        variants = validateBody(request.body);
      } catch (error) {
        return reply.code(400).send(errorBody("INVALID_EXPERIENCE", (error as Error).message));
      }
      if (!(await validateCategory(app, request.body.categoryId))) {
        return reply
          .code(400)
          .send(errorBody("INVALID_CATEGORY", "Experience category not found or inactive"));
      }
      try {
        const id = await app.db.transaction(async (tx) => {
          const [created] = await tx
            .insert(experiences)
            .values(values(request.body, Math.min(...variants.map((variant) => variant.price))))
            .returning({ id: experiences.id });
          await tx.insert(experienceVariants).values(
            variants.map((variant, index) => ({
              experienceId: created.id,
              ...variant,
              sortOrder: index,
            })),
          );
          return created.id;
        });
        return reply.code(201).send({ experience: await getDetail(app, id) });
      } catch (error) {
        if (databaseErrorCode(error) === "23505")
          return reply
            .code(409)
            .send(
              errorBody(
                "DUPLICATE_EXPERIENCE",
                "Experience code, slug, or variant sub name already exists",
              ),
            );
        if (databaseErrorCode(error) === "23503")
          return reply
            .code(400)
            .send(errorBody("INVALID_REFERENCE", "A referenced item is unavailable"));
        throw error;
      }
    },
  );

  app.put<{ Params: IdParams; Body: ExperienceBody }>(
    "/:id",
    {
      preHandler: app.requirePermission("experiences.edit"),
      schema: { params: experienceParamsSchema, body: experienceBodySchema },
    },
    async (request, reply) => {
      let variants;
      try {
        variants = validateBody(request.body);
      } catch (error) {
        return reply.code(400).send(errorBody("INVALID_EXPERIENCE", (error as Error).message));
      }
      const [current] = await app.db
        .select({ categoryId: experiences.categoryId })
        .from(experiences)
        .where(eq(experiences.id, request.params.id))
        .limit(1);
      if (!current) return reply.code(404).send(errorBody("NOT_FOUND", "Experience not found"));
      if (!(await validateCategory(
        app,
        request.body.categoryId,
        request.body.categoryId === current.categoryId,
      ))) {
        return reply
          .code(400)
          .send(errorBody("INVALID_CATEGORY", "Experience category not found or inactive"));
      }
      try {
        const changed = await app.db.transaction(async (tx) => {
          const [updated] = await tx
            .update(experiences)
            .set({
              ...values(request.body, Math.min(...variants.map((variant) => variant.price))),
              updatedAt: new Date(),
            })
            .where(eq(experiences.id, request.params.id))
            .returning({ id: experiences.id });
          if (!updated) return false;
          await tx
            .delete(experienceVariants)
            .where(eq(experienceVariants.experienceId, updated.id));
          await tx.insert(experienceVariants).values(
            variants.map((variant, index) => ({
              experienceId: updated.id,
              ...variant,
              sortOrder: index,
            })),
          );
          return true;
        });
        if (!changed) return reply.code(404).send(errorBody("NOT_FOUND", "Experience not found"));
        return { experience: await getDetail(app, request.params.id) };
      } catch (error) {
        if (databaseErrorCode(error) === "23505")
          return reply
            .code(409)
            .send(
              errorBody(
                "DUPLICATE_EXPERIENCE",
                "Experience code, slug, or variant sub name already exists",
              ),
            );
        if (databaseErrorCode(error) === "23503")
          return reply
            .code(400)
            .send(errorBody("INVALID_REFERENCE", "A referenced item is unavailable"));
        throw error;
      }
    },
  );

  app.patch<{ Params: IdParams; Body: { isActive: boolean } }>(
    "/:id/status",
    {
      preHandler: app.requirePermission("experiences.disable"),
      schema: {
        params: experienceParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["isActive"],
          properties: { isActive: { type: "boolean" } },
        },
      },
    },
    async (request, reply) => {
      const [updated] = await app.db
        .update(experiences)
        .set({ isActive: request.body.isActive, updatedAt: new Date() })
        .where(eq(experiences.id, request.params.id))
        .returning({ id: experiences.id });
      if (!updated) return reply.code(404).send(errorBody("NOT_FOUND", "Experience not found"));
      return { experience: await getDetail(app, updated.id) };
    },
  );
};
