import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { masterItems } from "../../db/schema/master_items.schema.js";
import { roomTypes } from "../../db/schema/room_types.schema.js";
import { roomUnits } from "../../db/schema/room_units.schema.js";
import { databaseErrorCode, uuidSchema } from "../master/master.shared.js";
import {
  roomNumberBodySchema,
  roomNumberParamsSchema,
  roomOperationalStatuses,
  type RoomNumberBody,
  type RoomOperationalStatus,
} from "./room-numbers.schemas.js";

type IdParams = { id: string };
type ListQuery = {
  search?: string;
  roomTypeId?: string;
  floorId?: string;
  operationalStatus?: RoomOperationalStatus;
  isActive?: boolean;
  page?: number;
  limit?: number;
};

const errorBody = (code: string, message: string) => ({ error: { code, message } });

function roomNumberValues(body: RoomNumberBody) {
  return {
    roomNumber: body.roomNumber.trim(),
    roomTypeId: body.roomTypeId,
    floorId: body.floorId ?? null,
    bedConfiguration: body.bedConfiguration?.trim() || null,
    operationalStatus: body.operationalStatus,
    isActive: body.isActive,
  };
}

export const roomNumberRoutes: FastifyPluginAsync = async (app) => {
  async function validateReferences(body: RoomNumberBody): Promise<string | null> {
    const [roomType] = await app.db
      .select({ id: roomTypes.id })
      .from(roomTypes)
      .where(and(eq(roomTypes.id, body.roomTypeId), eq(roomTypes.isActive, true)))
      .limit(1);
    if (!roomType) return "Room type not found or inactive";

    if (body.floorId) {
      const [floor] = await app.db
        .select({ id: masterItems.id })
        .from(masterItems)
        .where(
          and(
            eq(masterItems.id, body.floorId),
            eq(masterItems.category, "floors"),
            eq(masterItems.isActive, true),
          ),
        )
        .limit(1);
      if (!floor) return "Floor not found, inactive, or in the wrong master category";
    }
    return null;
  }

  const roomFields = {
    id: roomUnits.id,
    roomNumber: roomUnits.roomNumber,
    roomTypeId: roomUnits.roomTypeId,
    roomTypeCode: roomTypes.code,
    roomTypeName: roomTypes.name,
    floorId: roomUnits.floorId,
    floorName: masterItems.name,
    bedConfiguration: roomUnits.bedConfiguration,
    operationalStatus: roomUnits.operationalStatus,
    isActive: roomUnits.isActive,
    createdAt: roomUnits.createdAt,
    updatedAt: roomUnits.updatedAt,
  };

  function roomQuery() {
    return app.db
      .select(roomFields)
      .from(roomUnits)
      .innerJoin(roomTypes, eq(roomUnits.roomTypeId, roomTypes.id))
      .leftJoin(masterItems, eq(roomUnits.floorId, masterItems.id));
  }

  app.get<{ Querystring: ListQuery }>(
    "/",
    {
      preHandler: app.requirePermission("rooms.view_numbers"),
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            search: { type: "string", maxLength: 160 },
            roomTypeId: uuidSchema,
            floorId: uuidSchema,
            operationalStatus: { type: "string", enum: roomOperationalStatuses },
            isActive: { type: "boolean" },
            page: { type: "integer", minimum: 1, default: 1 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (request) => {
      const {
        search,
        roomTypeId,
        floorId,
        operationalStatus,
        isActive,
        page = 1,
        limit = 20,
      } = request.query;
      const term = search?.trim();
      const filter = and(
        roomTypeId ? eq(roomUnits.roomTypeId, roomTypeId) : undefined,
        floorId ? eq(roomUnits.floorId, floorId) : undefined,
        operationalStatus ? eq(roomUnits.operationalStatus, operationalStatus) : undefined,
        isActive === undefined ? undefined : eq(roomUnits.isActive, isActive),
        term
          ? or(ilike(roomUnits.roomNumber, `%${term}%`), ilike(roomTypes.name, `%${term}%`))
          : undefined,
      );
      const [items, [count]] = await Promise.all([
        roomQuery()
          .where(filter)
          .orderBy(asc(roomUnits.roomNumber))
          .limit(limit)
          .offset((page - 1) * limit),
        app.db
          .select({ total: sql<number>`count(*)::int` })
          .from(roomUnits)
          .innerJoin(roomTypes, eq(roomUnits.roomTypeId, roomTypes.id))
          .where(filter),
      ]);
      return { items, page, limit, total: count.total };
    },
  );

  app.get<{ Params: IdParams }>(
    "/:id",
    {
      preHandler: app.requirePermission("rooms.view_numbers"),
      schema: { params: roomNumberParamsSchema },
    },
    async (request, reply) => {
      const [roomNumber] = await roomQuery().where(eq(roomUnits.id, request.params.id)).limit(1);
      if (!roomNumber) return reply.code(404).send(errorBody("NOT_FOUND", "Room number not found"));
      return { roomNumber };
    },
  );

  app.post<{ Body: RoomNumberBody }>(
    "/",
    {
      preHandler: app.requirePermission("rooms.create_number"),
      schema: { body: roomNumberBodySchema },
    },
    async (request, reply) => {
      if (!request.body.roomNumber.trim()) {
        return reply.code(400).send(errorBody("INVALID_ROOM_NUMBER", "Room number is required"));
      }
      const referenceError = await validateReferences(request.body);
      if (referenceError)
        return reply.code(400).send(errorBody("INVALID_REFERENCE", referenceError));
      try {
        const [created] = await app.db
          .insert(roomUnits)
          .values(roomNumberValues(request.body))
          .returning({ id: roomUnits.id });
        const [roomNumber] = await roomQuery().where(eq(roomUnits.id, created.id)).limit(1);
        return reply.code(201).send({ roomNumber });
      } catch (error) {
        if (databaseErrorCode(error) === "23505")
          return reply
            .code(409)
            .send(errorBody("DUPLICATE_ROOM_NUMBER", "Room number already exists"));
        if (databaseErrorCode(error) === "23503")
          return reply
            .code(400)
            .send(errorBody("INVALID_REFERENCE", "Room type or floor is unavailable"));
        throw error;
      }
    },
  );

  app.put<{ Params: IdParams; Body: RoomNumberBody }>(
    "/:id",
    {
      preHandler: app.requirePermission("rooms.edit_number"),
      schema: { params: roomNumberParamsSchema, body: roomNumberBodySchema },
    },
    async (request, reply) => {
      if (!request.body.roomNumber.trim()) {
        return reply.code(400).send(errorBody("INVALID_ROOM_NUMBER", "Room number is required"));
      }
      const referenceError = await validateReferences(request.body);
      if (referenceError)
        return reply.code(400).send(errorBody("INVALID_REFERENCE", referenceError));
      try {
        const [updated] = await app.db
          .update(roomUnits)
          .set({ ...roomNumberValues(request.body), updatedAt: new Date() })
          .where(eq(roomUnits.id, request.params.id))
          .returning({ id: roomUnits.id });
        if (!updated) return reply.code(404).send(errorBody("NOT_FOUND", "Room number not found"));
        const [roomNumber] = await roomQuery().where(eq(roomUnits.id, updated.id)).limit(1);
        return { roomNumber };
      } catch (error) {
        if (databaseErrorCode(error) === "23505")
          return reply
            .code(409)
            .send(errorBody("DUPLICATE_ROOM_NUMBER", "Room number already exists"));
        if (databaseErrorCode(error) === "23503")
          return reply
            .code(400)
            .send(errorBody("INVALID_REFERENCE", "Room type or floor is unavailable"));
        throw error;
      }
    },
  );

  app.patch<{ Params: IdParams; Body: { operationalStatus: RoomOperationalStatus } }>(
    "/:id/operational-status",
    {
      preHandler: app.requirePermission("rooms.change_operational_status"),
      schema: {
        params: roomNumberParamsSchema,
        body: {
          type: "object",
          required: ["operationalStatus"],
          additionalProperties: false,
          properties: { operationalStatus: { type: "string", enum: roomOperationalStatuses } },
        },
      },
    },
    async (request, reply) => {
      const [updated] = await app.db
        .update(roomUnits)
        .set({ operationalStatus: request.body.operationalStatus, updatedAt: new Date() })
        .where(eq(roomUnits.id, request.params.id))
        .returning({ id: roomUnits.id });
      if (!updated) return reply.code(404).send(errorBody("NOT_FOUND", "Room number not found"));
      const [roomNumber] = await roomQuery().where(eq(roomUnits.id, updated.id)).limit(1);
      return { roomNumber };
    },
  );

  app.delete<{ Params: IdParams }>(
    "/:id",
    {
      preHandler: app.requirePermission("rooms.edit_number"),
      schema: { params: roomNumberParamsSchema },
    },
    async (request, reply) => {
      try {
        const [deleted] = await app.db
          .delete(roomUnits)
          .where(eq(roomUnits.id, request.params.id))
          .returning({ id: roomUnits.id });
        if (!deleted) return reply.code(404).send(errorBody("NOT_FOUND", "Room number not found"));
        return reply.code(204).send();
      } catch (error) {
        if (databaseErrorCode(error) === "23503")
          return reply
            .code(409)
            .send(
              errorBody(
                "ROOM_IN_USE",
                "Room has reservation or change history; deactivate it instead",
              ),
            );
        throw error;
      }
    },
  );
};
