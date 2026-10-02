import { boolean, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn } from "./columns.js";
import { roles } from "./roles.schema.js";

import { appSchema } from "./app-schema.js";

export const users = appSchema.table("users", {
  id: idColumn(),
  roleId: uuid("role_id")
    .notNull()
    .references(() => roles.id),
  name: varchar("name", { length: 160 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  username: varchar("username", { length: 80 }).unique(),
  phone: varchar("phone", { length: 40 }),
  passwordHash: text("password_hash").notNull(),
  photoUrl: text("photo_url"),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...auditTimestamps(),
});
