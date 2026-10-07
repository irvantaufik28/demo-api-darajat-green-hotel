import type { FastifyPluginAsync } from "fastify";
import { listFeaturedRooms } from "../services/featured-rooms.service.js";

export const featuredRoomsPublicRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => ({ items: await listFeaturedRooms(app, true) }));
};
