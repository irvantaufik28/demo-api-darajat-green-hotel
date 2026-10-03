import type { FastifyPluginAsync } from "fastify";
import { healthRoutes } from "../modules/health/index.js";
import { adminRoutes } from "./admin/index.js";
import { publicRoutes } from "./public/index.js";

export const apiRoutes: FastifyPluginAsync = async (app) => {
  await app.register(healthRoutes);
  await app.register(publicRoutes, { prefix: "/public" });
  await app.register(adminRoutes, { prefix: "/admin" });
};
