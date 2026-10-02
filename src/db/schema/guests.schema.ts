import { sql } from "drizzle-orm";
import { check, pgTable, text, varchar } from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn } from "./columns.js";

export const guests = pgTable(
  "guests",
  {
    id: idColumn(),
    fullName: varchar("full_name", { length: 160 }).notNull(),
    phone: varchar("phone", { length: 40 }),
    email: varchar("email", { length: 255 }),
    nationality: text("nationality"),
    address: text("address"),
    internalNotes: text("internal_notes"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    ...auditTimestamps(),
  },
  (table) => [check("guests_status_check", sql`${table.status} in ('active', 'blacklisted')`)],
);
