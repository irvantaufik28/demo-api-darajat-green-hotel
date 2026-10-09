import Fastify from "fastify";
import { loadConfig } from "./config/env.js";
import { processAutomaticNoShows } from "./modules/reservations/services/reservation-no-show-worker.service.js";
import { registerDatabase } from "./plugins/database.js";

const POLL_INTERVAL_MS = 60_000;
const config = loadConfig();
const app = Fastify({ logger: { level: config.logLevel }, disableRequestLogging: true });
registerDatabase(app, config);

let timer: NodeJS.Timeout | undefined;
let currentRun: Promise<void> | undefined;

async function runBatch() {
  try {
    const result = await processAutomaticNoShows(app.db);
    if (result.processed > 0 || result.skipped > 0) {
      app.log.info(result, "Reservation no-show batch processed");
    }
  } catch (error) {
    app.log.error({ err: error }, "Reservation no-show worker batch failed");
  }
}

function scheduleBatch() {
  if (currentRun) return;
  currentRun = runBatch().finally(() => {
    currentRun = undefined;
  });
}

async function start() {
  try {
    await app.ready();
    await runBatch();
    timer = setInterval(scheduleBatch, POLL_INTERVAL_MS);
    app.log.info({ pollIntervalMs: POLL_INTERVAL_MS }, "Reservation worker started");
  } catch (error) {
    app.log.fatal({ err: error }, "Reservation worker failed to start");
    process.exitCode = 1;
    await app.close();
  }
}

async function shutdown(signal: string) {
  app.log.info({ signal }, "Shutting down reservation worker");
  if (timer) clearInterval(timer);
  if (currentRun) await currentRun;
  await app.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
void start();
