import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { cancellationPolicies } from "../../../db/schema/cancellation_policies.schema.js";
import { databaseErrorCode } from "../../master/master.shared.js";
import {
  cancellationPolicyValues,
  CancellationPolicyInputError,
  getCancellationPolicyDetail,
  replaceCancellationPolicyRelations,
  validateCancellationPolicy,
} from "../services/cancellation-policies.service.js";
import {
  cancellationPolicyBodySchema,
  cancellationPolicyParamsSchema,
  type CancellationPolicyBody,
} from "../schemas/cancellation-policies.schema.js";

type IdParams = { id: string };
type ListQuery = {
  search?: string;
  source?: "website" | "phone";
  isActive?: boolean;
  page?: number;
  limit?: number;
};

const errorBody = (code: string, message: string) => ({ error: { code, message } });

export const cancellationPolicyRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListQuery }>(
    "/",
    {
      preHandler: app.requirePermission("cancellation_policies.view"),
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            search: { type: "string", maxLength: 160 },
            source: { type: "string", enum: ["website", "phone"] },
            isActive: { type: "boolean" },
            page: { type: "integer", minimum: 1, default: 1 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (request) => {
      const { search, source, isActive, page = 1, limit = 20 } = request.query;
      const filter = and(
        search?.trim() ? ilike(cancellationPolicies.name, `%${search.trim()}%`) : undefined,
        source === "website"
          ? eq(cancellationPolicies.appliesWebsite, true)
          : source === "phone"
            ? eq(cancellationPolicies.appliesPhone, true)
            : undefined,
        isActive === undefined ? undefined : eq(cancellationPolicies.isActive, isActive),
      );
      const [items, [total]] = await Promise.all([
        app.db
          .select()
          .from(cancellationPolicies)
          .where(filter)
          .orderBy(desc(cancellationPolicies.createdAt), asc(cancellationPolicies.name))
          .limit(limit)
          .offset((page - 1) * limit),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(cancellationPolicies)
          .where(filter),
      ]);
      return { items, page, limit, total: total.count };
    },
  );

  app.get<{ Params: IdParams }>(
    "/:id",
    {
      preHandler: app.requirePermission("cancellation_policies.view"),
      schema: { params: cancellationPolicyParamsSchema },
    },
    async (request, reply) => {
      const policy = await getCancellationPolicyDetail(app.db, request.params.id);
      if (!policy) return reply.code(404).send(errorBody("NOT_FOUND", "Policy not found"));
      return { policy };
    },
  );

  app.post<{ Body: CancellationPolicyBody }>(
    "/",
    {
      preHandler: app.requirePermission("cancellation_policies.create"),
      schema: { body: cancellationPolicyBodySchema },
    },
    async (request, reply) => {
      try {
        const policyTypeName = await validateCancellationPolicy(app.db, request.body);
        const id = await app.db.transaction(async (tx) => {
          const [created] = await tx
            .insert(cancellationPolicies)
            .values(cancellationPolicyValues(request.body, policyTypeName))
            .returning({ id: cancellationPolicies.id });
          await replaceCancellationPolicyRelations(tx, created.id, request.body);
          return created.id;
        });
        return reply.code(201).send({ policy: await getCancellationPolicyDetail(app.db, id) });
      } catch (error) {
        if (error instanceof CancellationPolicyInputError)
          return reply.code(400).send(errorBody("INVALID_POLICY", error.message));
        if (databaseErrorCode(error) === "23503")
          return reply
            .code(400)
            .send(errorBody("INVALID_REFERENCE", "A referenced item is unavailable"));
        throw error;
      }
    },
  );

  app.put<{ Params: IdParams; Body: CancellationPolicyBody }>(
    "/:id",
    {
      preHandler: app.requirePermission("cancellation_policies.edit"),
      schema: { params: cancellationPolicyParamsSchema, body: cancellationPolicyBodySchema },
    },
    async (request, reply) => {
      try {
        const policyTypeName = await validateCancellationPolicy(app.db, request.body);
        const changed = await app.db.transaction(async (tx) => {
          const [updated] = await tx
            .update(cancellationPolicies)
            .set({ ...cancellationPolicyValues(request.body, policyTypeName), updatedAt: new Date() })
            .where(eq(cancellationPolicies.id, request.params.id))
            .returning({ id: cancellationPolicies.id });
          if (!updated) return false;
          await replaceCancellationPolicyRelations(tx, updated.id, request.body);
          return true;
        });
        if (!changed) return reply.code(404).send(errorBody("NOT_FOUND", "Policy not found"));
        return { policy: await getCancellationPolicyDetail(app.db, request.params.id) };
      } catch (error) {
        if (error instanceof CancellationPolicyInputError)
          return reply.code(400).send(errorBody("INVALID_POLICY", error.message));
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
      preHandler: app.requirePermission("cancellation_policies.disable"),
      schema: {
        params: cancellationPolicyParamsSchema,
        body: {
          type: "object",
          required: ["isActive"],
          additionalProperties: false,
          properties: { isActive: { type: "boolean" } },
        },
      },
    },
    async (request, reply) => {
      const [policy] = await app.db
        .update(cancellationPolicies)
        .set({ isActive: request.body.isActive, updatedAt: new Date() })
        .where(eq(cancellationPolicies.id, request.params.id))
        .returning();
      if (!policy) return reply.code(404).send(errorBody("NOT_FOUND", "Policy not found"));
      return { policy };
    },
  );
};
