import Fastify from "fastify";
import { loadConfig } from "./config/env.js";
import { registerAuth } from "./plugins/auth.js";
import { registerDatabase } from "./plugins/database.js";
import { apiRoutes } from "./routes/index.js";

const config = loadConfig();
const app = Fastify({
  logger: { level: config.logLevel },
  disableRequestLogging: config.nodeEnv === "test",
});

registerDatabase(app, config);
registerAuth(app, config);
app.register(apiRoutes, { prefix: "/api/v1" });

async function start() {
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error(error, "Failed to start API");
    process.exitCode = 1;
  }
}

async function shutdown(signal: string) {
  app.log.info({ signal }, "Shutting down API");
  try {
    await app.close();
  } catch (error) {
    app.log.error(error, "Failed to close API");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

void start();
