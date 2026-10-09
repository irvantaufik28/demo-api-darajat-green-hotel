import Fastify from "fastify";
import { loadConfig } from "./config/env.js";
import { processEmailOutbox } from "./modules/email/services/email-outbox.service.js";
import { registerDatabase } from "./plugins/database.js";

const POLL_INTERVAL_MS = 30_000;
const config = loadConfig();
const app = Fastify({
  logger: { level: config.logLevel },
  disableRequestLogging: true,
});

registerDatabase(app, config);
app.decorate("authConfig", config);

let timer: NodeJS.Timeout | undefined;
let currentRun: Promise<void> | undefined;

async function runBatch() {
  try {
    const result = await processEmailOutbox(app);
    if (result.processed > 0) {
      app.log.info({ processed: result.processed }, "Email outbox batch processed");
    }
  } catch (error) {
    app.log.error({ err: error }, "Email outbox worker batch failed");
  }
}

function scheduleBatch() {
  if (currentRun) return;
  currentRun = runBatch().finally(() => {
    currentRun = undefined;
  });
}

async function start() {
  if (!config.email) {
    app.log.fatal("Email worker requires complete EMAIL_* configuration");
    process.exitCode = 1;
    return;
  }
  try {
    await app.ready();
    await runBatch();
    timer = setInterval(scheduleBatch, POLL_INTERVAL_MS);
    app.log.info({ pollIntervalMs: POLL_INTERVAL_MS }, "Email outbox worker started");
  } catch (error) {
    app.log.fatal({ err: error }, "Email outbox worker failed to start");
    process.exitCode = 1;
    await app.close();
  }
}

async function shutdown(signal: string) {
  app.log.info({ signal }, "Shutting down email outbox worker");
  if (timer) clearInterval(timer);
  if (currentRun) await currentRun;
  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, "Failed to close email outbox worker");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

void start();
