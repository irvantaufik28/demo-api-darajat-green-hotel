import { sql } from "drizzle-orm";
import { check, primaryKey, smallint, uuid } from "drizzle-orm/pg-core";
import { appSchema } from "./app-schema.js";
import { capacityPatterns } from "./capacity_patterns.schema.js";
import { roomTypes } from "./room_types.schema.js";

export const roomTypeCapacityPatterns = appSchema.table(
  "room_type_capacity_patterns",
  {
    roomTypeId: uuid("room_type_id")
      .notNull()
      .references(() => roomTypes.id, { onDelete: "cascade" }),
    capacityPatternId: uuid("capacity_pattern_id")
      .notNull()
      .references(() => capacityPatterns.id),
    extraBeds: smallint("extra_beds").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.roomTypeId, table.capacityPatternId] }),
    check("room_type_capacity_patterns_extra_beds_check", sql`${table.extraBeds} >= 0`),
  ],
);
