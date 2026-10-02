import Fastify from "fastify";
import type { AppConfig } from "./config/env.js";
import { registerAuth } from "./plugins/auth.js";
import { registerDatabase } from "./plugins/database.js";
import { apiRoutes } from "./routes/index.js";

export function buildApp(config: AppConfig) {
  const app = Fastify({
    logger: { level: config.logLevel },
    disableRequestLogging: config.nodeEnv === "test",
  });

  registerDatabase(app, config);
  registerAuth(app, config);
  app.register(apiRoutes, { prefix: "/api/v1" });

  return app;
}
