import { bigint, timestamp, uuid } from "drizzle-orm/pg-core";

export const idColumn = () => uuid("id").defaultRandom().primaryKey();
export const rupiah = (name: string) => bigint(name, { mode: "number" });
export const auditTimestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
