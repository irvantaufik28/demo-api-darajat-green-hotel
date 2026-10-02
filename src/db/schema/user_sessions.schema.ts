import { index, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn } from "./columns.js";
import { users } from "./users.schema.js";

import { appSchema } from "./app-schema.js";

export const userSessions = appSchema.table(
  "user_sessions",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("user_sessions_user_id_idx").on(table.userId)],
);
