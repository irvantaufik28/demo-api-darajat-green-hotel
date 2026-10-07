import { sql } from "drizzle-orm";
import { boolean, check, integer, smallint, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn } from "./columns.js";
import { hotelInfo } from "./hotel_info.schema.js";
import { appSchema } from "./app-schema.js";

export const hotelFacilities = appSchema.table(
  "hotel_facilities",
  {
    id: idColumn(),
    hotelId: smallint("hotel_id")
      .notNull()
      .default(1)
      .references(() => hotelInfo.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    kind: varchar("kind", { length: 20 }).notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...auditTimestamps(),
  },
  (table) => [
    check("hotel_facilities_kind_check", sql`${table.kind} in ('facility', 'service')`),
    uniqueIndex("hotel_facilities_hotel_kind_name_unique").on(
      table.hotelId,
      table.kind,
      table.name,
    ),
  ],
);
