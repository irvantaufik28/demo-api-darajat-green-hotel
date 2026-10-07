import { sql } from "drizzle-orm";
import { boolean, check, integer, uuid } from "drizzle-orm/pg-core";
import { auditTimestamps } from "./columns.js";
import { roomTypes } from "./room_types.schema.js";
import { appSchema } from "./app-schema.js";

export const featuredRoomTypes = appSchema.table(
  "featured_room_types",
  {
    roomTypeId: uuid("room_type_id")
      .primaryKey()
      .references(() => roomTypes.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...auditTimestamps(),
  },
  (table) => [check("featured_room_types_sort_order_check", sql`${table.sortOrder} >= 0`)],
);
