import { drizzle } from "drizzle-orm/node-postgres";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import type { AppConfig } from "../config/env.js";
import * as schema from "../db/schema/index.js";

export type Database = ReturnType<typeof createDatabase>;

function createDatabase(pool: Pool) {
  return drizzle({ client: pool, schema });
}

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
    pgPool: Pool;
  }
}

export function registerDatabase(app: FastifyInstance, config: AppConfig): void {
  const databaseUrl = new URL(config.databaseUrl);
  const connectionTarget = {
    host: databaseUrl.hostname,
    port: databaseUrl.port || "5432",
    database: databaseUrl.pathname.slice(1),
  };
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });

  pool.on("error", (error) => {
    app.log.error({ err: error }, "PostgreSQL idle client error");
  });

  app.decorate("pgPool", pool);
  app.decorate("db", createDatabase(pool));

  app.addHook("onReady", async () => {
    try {
      await pool.query("SELECT 1");
      app.log.info(connectionTarget, "PostgreSQL connected");
    } catch (error) {
      app.log.error({ err: error, ...connectionTarget }, "PostgreSQL connection failed");
      throw error;
    }
  });

  app.addHook("onClose", async () => {
    await pool.end();
    app.log.info(connectionTarget, "PostgreSQL connection pool closed");
  });
}
