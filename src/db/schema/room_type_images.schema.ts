import { sql } from "drizzle-orm";
import { boolean, integer, pgTable, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn } from "./columns.js";
import { roomTypes } from "./room_types.schema.js";

export const roomTypeImages = pgTable(
  "room_type_images",
  {
    id: idColumn(),
    roomTypeId: uuid("room_type_id")
      .notNull()
      .references(() => roomTypes.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    altText: varchar("alt_text", { length: 255 }),
    isCover: boolean("is_cover").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("room_type_images_one_cover_uq")
      .on(table.roomTypeId)
      .where(sql`${table.isCover} = true`),
  ],
);
