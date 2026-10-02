import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

if (existsSync(".env")) process.loadEnvFile(".env");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for Drizzle Kit");

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl },
  strict: true,
});
