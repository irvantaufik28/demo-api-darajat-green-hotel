import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { roomTypeImages } from "../../db/schema/room_type_images.schema.js";
import { roomTypes } from "../../db/schema/room_types.schema.js";
import { databaseErrorCode } from "../master/master.shared.js";
import {
  getRoomTypeDetail,
  replaceRoomTypeRelations,
  RoomTypeInputError,
  roomTypeValues,
  validateRoomTypeReferences,
} from "./room-types.service.js";
import {
  roomTypeBodySchema,
  roomTypeParamsSchema,
  type RoomTypeBody,
} from "./room-types.schemas.js";

type IdParams = { id: string };
type ListQuery = { search?: string; isActive?: boolean; page?: number; limit?: number };

const errorBody = (code: string, message: string) => ({ error: { code, message } });

export const roomTypeRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListQuery }>(
    "/",
    {
      preHandler: app.requirePermission("rooms.view_types"),
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            search: { type: "string", maxLength: 160 },
            isActive: { type: "boolean" },
            page: { type: "integer", minimum: 1, default: 1 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (request) => {
      const { search, isActive, page = 1, limit = 20 } = request.query;
      const term = search?.trim();
      const filter = and(
        isActive === undefined ? undefined : eq(roomTypes.isActive, isActive),
        term
          ? or(ilike(roomTypes.name, `%${term}%`), ilike(roomTypes.code, `%${term}%`))
          : undefined,
      );
      const [items, [count]] = await Promise.all([
        app.db
          .select({ roomType: roomTypes, coverImage: roomTypeImages })
          .from(roomTypes)
          .leftJoin(
            roomTypeImages,
            and(eq(roomTypeImages.roomTypeId, roomTypes.id), eq(roomTypeImages.isCover, true)),
          )
          .where(filter)
          .orderBy(desc(roomTypes.createdAt), asc(roomTypes.name))
          .limit(limit)
          .offset((page - 1) * limit),
        app.db
          .select({ total: sql<number>`count(*)::int` })
          .from(roomTypes)
          .where(filter),
      ]);
      return {
        items: items.map(({ roomType, coverImage }) => ({ ...roomType, coverImage })),
        page,
        limit,
        total: count.total,
      };
    },
  );

  app.get<{ Params: IdParams }>(
    "/:id",
    {
      preHandler: app.requirePermission("rooms.view_types"),
      schema: { params: roomTypeParamsSchema },
    },
    async (request, reply) => {
      const roomType = await getRoomTypeDetail(app.db, request.params.id);
      if (!roomType) return reply.code(404).send(errorBody("NOT_FOUND", "Room type not found"));
      return { roomType };
    },
  );

  app.post<{ Body: RoomTypeBody }>(
    "/",
    {
      preHandler: app.requirePermission("rooms.create_type"),
      schema: { body: roomTypeBodySchema },
    },
    async (request, reply) => {
      try {
        await validateRoomTypeReferences(app.db, request.body);
        const id = await app.db.transaction(async (tx) => {
          const [created] = await tx
            .insert(roomTypes)
            .values(roomTypeValues(request.body))
            .returning({ id: roomTypes.id });
          await replaceRoomTypeRelations(tx, created.id, request.body);
          return created.id;
        });
        return reply.code(201).send({ roomType: await getRoomTypeDetail(app.db, id) });
      } catch (error) {
        if (error instanceof RoomTypeInputError)
          return reply.code(400).send(errorBody("INVALID_ROOM_TYPE", error.message));
        if (databaseErrorCode(error) === "23505")
          return reply
            .code(409)
            .send(errorBody("DUPLICATE_ROOM_TYPE", "Room type code or slug already exists"));
        if (databaseErrorCode(error) === "23503")
          return reply
            .code(400)
            .send(errorBody("INVALID_REFERENCE", "A referenced master item is unavailable"));
        throw error;
      }
    },
  );

  app.put<{ Params: IdParams; Body: RoomTypeBody }>(
    "/:id",
    {
      preHandler: app.requirePermission("rooms.edit_type"),
      schema: { params: roomTypeParamsSchema, body: roomTypeBodySchema },
    },
    async (request, reply) => {
      try {
        await validateRoomTypeReferences(app.db, request.body);
        const updated = await app.db.transaction(async (tx) => {
          const [item] = await tx
            .update(roomTypes)
            .set({ ...roomTypeValues(request.body), updatedAt: new Date() })
            .where(eq(roomTypes.id, request.params.id))
            .returning({ id: roomTypes.id });
          if (!item) return false;
          await replaceRoomTypeRelations(tx, item.id, request.body);
          return true;
        });
        if (!updated) return reply.code(404).send(errorBody("NOT_FOUND", "Room type not found"));
        return { roomType: await getRoomTypeDetail(app.db, request.params.id) };
      } catch (error) {
        if (error instanceof RoomTypeInputError)
          return reply.code(400).send(errorBody("INVALID_ROOM_TYPE", error.message));
        if (databaseErrorCode(error) === "23505")
          return reply
            .code(409)
            .send(errorBody("DUPLICATE_ROOM_TYPE", "Room type code or slug already exists"));
        if (databaseErrorCode(error) === "23503")
          return reply
            .code(400)
            .send(errorBody("INVALID_REFERENCE", "A referenced master item is unavailable"));
        throw error;
      }
    },
  );

  app.patch<{ Params: IdParams; Body: { isActive: boolean } }>(
    "/:id/status",
    {
      preHandler: app.requirePermission("rooms.disable_type"),
      schema: {
        params: roomTypeParamsSchema,
        body: {
          type: "object",
          required: ["isActive"],
          additionalProperties: false,
          properties: { isActive: { type: "boolean" } },
        },
      },
    },
    async (request, reply) => {
      const [roomType] = await app.db
        .update(roomTypes)
        .set({ isActive: request.body.isActive, updatedAt: new Date() })
        .where(eq(roomTypes.id, request.params.id))
        .returning();
      if (!roomType) return reply.code(404).send(errorBody("NOT_FOUND", "Room type not found"));
      return { roomType };
    },
  );
};
