import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { idColumn } from "./columns.js";
import { users } from "./users.schema.js";

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: idColumn(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    action: varchar("action", { length: 80 }).notNull(),
    beforeData: jsonb("before_data"),
    afterData: jsonb("after_data"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
    index("audit_logs_actor_idx").on(table.actorUserId),
    index("audit_logs_created_idx").on(table.createdAt),
  ],
);
