import { boolean, pgTable, text, varchar } from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn } from "./columns.js";

export const roles = pgTable("roles", {
  id: idColumn(),
  name: varchar("name", { length: 80 }).notNull().unique(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  ...auditTimestamps(),
});
