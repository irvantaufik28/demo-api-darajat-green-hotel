import { and, asc, desc, eq, exists, ilike, inArray, or, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { campaignRoomTypes } from "../../../db/schema/campaign_room_types.schema.js";
import { campaigns } from "../../../db/schema/campaigns.schema.js";
import { databaseErrorCode, uuidSchema } from "../../master/master.shared.js";
import {
  campaignValues,
  CampaignInputError,
  getCampaignDetail,
  lockCampaignPriority,
  nextTemporaryPriority,
  normalizeCampaignPriorities,
  reorderCampaignPriorities,
  replaceCampaignRelations,
  validateCampaign,
} from "../services/campaigns.service.js";
import {
  campaignBodySchema,
  campaignParamsSchema,
  type CampaignBody,
  type CampaignChannel,
} from "../schemas/campaigns.schema.js";

type IdParams = { id: string };
type ListQuery = {
  search?: string;
  roomTypeId?: string;
  channel?: CampaignChannel;
  isActive?: boolean;
  page?: number;
  limit?: number;
};

const errorBody = (code: string, message: string) => ({ error: { code, message } });

function handleWriteError(
  error: unknown,
  reply: { code: (status: number) => { send: (body: unknown) => unknown } },
) {
  if (error instanceof CampaignInputError) {
    return reply.code(400).send(errorBody("INVALID_CAMPAIGN", error.message));
  }
  if (databaseErrorCode(error) === "23505") {
    return reply.code(409).send(errorBody("DUPLICATE_PROMO_CODE", "Promo code already exists"));
  }
  if (databaseErrorCode(error) === "23503") {
    return reply.code(400).send(errorBody("INVALID_REFERENCE", "A referenced item is unavailable"));
  }
  throw error;
}

export const campaignRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListQuery }>(
    "/",
    {
      preHandler: app.requirePermission("campaigns.view"),
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            search: { type: "string", maxLength: 160 },
            roomTypeId: uuidSchema,
            channel: { type: "string", enum: ["website", "front_desk"] },
            isActive: { type: "boolean" },
            page: { type: "integer", minimum: 1, default: 1 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (request) => {
      const { search, roomTypeId, channel, isActive, page = 1, limit = 20 } = request.query;
      const term = search?.trim();
      const filter = and(
        term
          ? or(ilike(campaigns.name, `%${term}%`), ilike(campaigns.promoCode, `%${term}%`))
          : undefined,
        isActive === undefined ? undefined : eq(campaigns.isActive, isActive),
        channel ? eq(campaigns.channel, channel) : undefined,
        roomTypeId
          ? or(
              exists(
                app.db
                  .select({ campaignId: campaignRoomTypes.campaignId })
                  .from(campaignRoomTypes)
                  .where(
                    and(
                      eq(campaignRoomTypes.campaignId, campaigns.id),
                      eq(campaignRoomTypes.roomTypeId, roomTypeId),
                    ),
                  ),
              ),
              sql`not exists (select 1 from ${campaignRoomTypes} where ${campaignRoomTypes.campaignId} = ${campaigns.id})`,
            )
          : undefined,
      );
      const [items, [total]] = await Promise.all([
        app.db
          .select()
          .from(campaigns)
          .where(filter)
          .orderBy(asc(campaigns.channel), asc(campaigns.priority), desc(campaigns.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(campaigns)
          .where(filter),
      ]);
      const ids = items.map((item) => item.id);
      const roomTypeLinks = ids.length
        ? await app.db
            .select()
            .from(campaignRoomTypes)
            .where(inArray(campaignRoomTypes.campaignId, ids))
        : [];
      return {
        items: items.map((item) => ({
          ...item,
          roomTypeIds: roomTypeLinks
            .filter((link) => link.campaignId === item.id)
            .map((link) => link.roomTypeId),
        })),
        page,
        limit,
        total: total.count,
      };
    },
  );

  app.get<{ Params: IdParams }>(
    "/:id",
    {
      preHandler: app.requirePermission("campaigns.view"),
      schema: { params: campaignParamsSchema },
    },
    async (request, reply) => {
      const campaign = await getCampaignDetail(app.db, request.params.id);
      if (!campaign) return reply.code(404).send(errorBody("NOT_FOUND", "Campaign not found"));
      return { campaign };
    },
  );

  app.post<{ Body: CampaignBody }>(
    "/",
    { preHandler: app.requirePermission("campaigns.create"), schema: { body: campaignBodySchema } },
    async (request, reply) => {
      try {
        await validateCampaign(app.db, request.body);
        const id = await app.db.transaction(async (tx) => {
          await lockCampaignPriority(tx);
          const temporaryPriority = await nextTemporaryPriority(tx, request.body.channel);
          const [created] = await tx
            .insert(campaigns)
            .values({ ...campaignValues(request.body), priority: temporaryPriority })
            .returning({ id: campaigns.id });
          await reorderCampaignPriorities(tx, created.id, request.body.priority);
          await replaceCampaignRelations(tx, created.id, request.body);
          return created.id;
        });
        return reply.code(201).send({ campaign: await getCampaignDetail(app.db, id) });
      } catch (error) {
        return handleWriteError(error, reply);
      }
    },
  );

  app.put<{ Params: IdParams; Body: CampaignBody }>(
    "/:id",
    {
      preHandler: app.requirePermission("campaigns.edit"),
      schema: { params: campaignParamsSchema, body: campaignBodySchema },
    },
    async (request, reply) => {
      try {
        await validateCampaign(app.db, request.body);
        const [existing] = await app.db
          .select({ priority: campaigns.priority, channel: campaigns.channel })
          .from(campaigns)
          .where(eq(campaigns.id, request.params.id))
          .limit(1);
        if (!existing) return reply.code(404).send(errorBody("NOT_FOUND", "Campaign not found"));
        if (
          existing.priority !== request.body.priority ||
          existing.channel !== request.body.channel
        ) {
          await app.requirePermission("campaigns.set_priority")(request, reply);
          if (reply.sent) return;
        }
        await app.db.transaction(async (tx) => {
          await lockCampaignPriority(tx);
          const {
            priority: _priority,
            channel: _channel,
            ...values
          } = campaignValues(request.body);
          if (existing.channel !== request.body.channel) {
            const temporaryPriority = await nextTemporaryPriority(tx, request.body.channel);
            await tx
              .update(campaigns)
              .set({
                ...values,
                channel: request.body.channel,
                priority: temporaryPriority,
                updatedAt: new Date(),
              })
              .where(eq(campaigns.id, request.params.id));
            await normalizeCampaignPriorities(tx, existing.channel);
          } else {
            await tx
              .update(campaigns)
              .set({ ...values, updatedAt: new Date() })
              .where(eq(campaigns.id, request.params.id));
          }
          await reorderCampaignPriorities(tx, request.params.id, request.body.priority);
          await replaceCampaignRelations(tx, request.params.id, request.body);
        });
        return { campaign: await getCampaignDetail(app.db, request.params.id) };
      } catch (error) {
        return handleWriteError(error, reply);
      }
    },
  );

  app.patch<{ Params: IdParams; Body: { priority: number } }>(
    "/:id/priority",
    {
      preHandler: app.requirePermission("campaigns.set_priority"),
      schema: {
        params: campaignParamsSchema,
        body: {
          type: "object",
          required: ["priority"],
          additionalProperties: false,
          properties: { priority: { type: "integer", minimum: 1, maximum: 10000 } },
        },
      },
    },
    async (request, reply) => {
      const changed = await app.db.transaction(async (tx) => {
        await lockCampaignPriority(tx);
        return reorderCampaignPriorities(tx, request.params.id, request.body.priority);
      });
      if (!changed) return reply.code(404).send(errorBody("NOT_FOUND", "Campaign not found"));
      return { campaign: await getCampaignDetail(app.db, request.params.id) };
    },
  );

  app.patch<{ Params: IdParams; Body: { isActive: boolean } }>(
    "/:id/status",
    {
      preHandler: app.requirePermission("campaigns.disable"),
      schema: {
        params: campaignParamsSchema,
        body: {
          type: "object",
          required: ["isActive"],
          additionalProperties: false,
          properties: { isActive: { type: "boolean" } },
        },
      },
    },
    async (request, reply) => {
      const [campaign] = await app.db
        .update(campaigns)
        .set({ isActive: request.body.isActive, updatedAt: new Date() })
        .where(eq(campaigns.id, request.params.id))
        .returning();
      if (!campaign) return reply.code(404).send(errorBody("NOT_FOUND", "Campaign not found"));
      return { campaign };
    },
  );
};
