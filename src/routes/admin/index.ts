import type { FastifyPluginAsync } from "fastify";
import { authRoutes } from "../../modules/auth/auth.routes.js";
import { masterRoutes } from "../../modules/master/master.routes.js";
import { roomTypeRoutes } from "../../modules/rooms/room-types.routes.js";
import { roomNumberRoutes } from "../../modules/rooms/room-numbers.routes.js";
import { pricesStocksRoutes } from "../../modules/prices-stocks/prices-stocks.routes.js";
import { cancellationPolicyRoutes } from "../../modules/cancellation-policies/cancellation-policies.routes.js";
import { campaignRoutes } from "../../modules/campaigns/campaigns.routes.js";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(masterRoutes, { prefix: "/master" });
  await app.register(roomTypeRoutes, { prefix: "/room-types" });
  await app.register(roomNumberRoutes, { prefix: "/room-numbers" });
  await app.register(pricesStocksRoutes, { prefix: "/prices-stocks" });
  await app.register(cancellationPolicyRoutes, { prefix: "/cancellation-policies" });
  await app.register(campaignRoutes, { prefix: "/campaigns" });
};
