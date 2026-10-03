import type { FastifyPluginAsync } from "fastify";
import { capacityPatternRoutes } from "./capacity-patterns.routes.js";
import { masterItemRoutes } from "./master-items.routes.js";

export const masterRoutes: FastifyPluginAsync = async (app) => {
  await app.register(capacityPatternRoutes, { prefix: "/capacity-patterns" });
  await app.register(masterItemRoutes);
};
