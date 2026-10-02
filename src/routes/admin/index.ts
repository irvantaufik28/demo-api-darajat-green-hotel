import type { FastifyPluginAsync } from "fastify";
import { authRoutes } from "../../modules/auth/auth.routes.js";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  await app.register(authRoutes, { prefix: "/auth" });
};
