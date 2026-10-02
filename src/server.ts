import { buildApp } from "./create-app.js";
import { loadConfig } from "./config/env.js";

const config = loadConfig();
const app = buildApp(config);

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
