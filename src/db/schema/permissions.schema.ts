import { pgTable, varchar } from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn } from "./columns.js";

export const permissions = pgTable("permissions", {
  id: idColumn(),
  code: varchar("code", { length: 120 }).notNull().unique(),
  module: varchar("module", { length: 80 }).notNull(),
  label: varchar("label", { length: 120 }).notNull(),
  ...auditTimestamps(),
});
