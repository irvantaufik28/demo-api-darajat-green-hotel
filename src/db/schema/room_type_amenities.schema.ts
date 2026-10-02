import { pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { masterItems } from "./master_items.schema.js";
import { roomTypes } from "./room_types.schema.js";

export const roomTypeAmenities = pgTable(
  "room_type_amenities",
  {
    roomTypeId: uuid("room_type_id")
      .notNull()
      .references(() => roomTypes.id, { onDelete: "cascade" }),
    amenityId: uuid("amenity_id")
      .notNull()
      .references(() => masterItems.id),
  },
  (table) => [primaryKey({ columns: [table.roomTypeId, table.amenityId] })],
);
