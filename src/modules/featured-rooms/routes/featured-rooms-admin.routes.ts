import { inArray } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { roomTypes } from "../../../db/schema/room_types.schema.js";
import {
  featuredRoomsBodySchema,
  type FeaturedRoomsBody,
} from "../schemas/featured-rooms.schema.js";
import { listFeaturedRooms, saveFeaturedRooms } from "../services/featured-rooms.service.js";

const errorBody = (code: string, message: string) => ({ error: { code, message } });

export const featuredRoomsAdminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: app.requirePermission("web_settings.manage") }, async () => ({
    items: await listFeaturedRooms(app, false),
  }));

  app.put<{ Body: FeaturedRoomsBody }>(
    "/",
    {
      preHandler: app.requirePermission("web_settings.manage"),
      schema: { body: featuredRoomsBodySchema },
    },
    async (request, reply) => {
      const ids = request.body.items.map((item) => item.roomTypeId);
      if (new Set(ids).size !== ids.length) {
        return reply
          .code(400)
          .send(errorBody("DUPLICATE_ROOM_TYPE", "Each room type can be selected once"));
      }

      if (ids.length) {
        const availableTypes = await app.db
          .select({ id: roomTypes.id, isActive: roomTypes.isActive })
          .from(roomTypes)
          .where(inArray(roomTypes.id, ids));
        const byId = new Map(availableTypes.map((roomType) => [roomType.id, roomType]));
        if (
          request.body.items.some(
            (item) =>
              !byId.has(item.roomTypeId) || (item.isActive && !byId.get(item.roomTypeId)?.isActive),
          )
        ) {
          return reply
            .code(400)
            .send(errorBody("ROOM_TYPE_UNAVAILABLE", "Selected room type is missing or inactive"));
        }
      }

      await saveFeaturedRooms(app, request.body);
      return { items: await listFeaturedRooms(app, false) };
    },
  );
};
