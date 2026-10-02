import { pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns.schema.js";
import { roomTypes } from "./room_types.schema.js";

export const campaignRoomTypes = pgTable(
  "campaign_room_types",
  {
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    roomTypeId: uuid("room_type_id")
      .notNull()
      .references(() => roomTypes.id),
  },
  (table) => [primaryKey({ columns: [table.campaignId, table.roomTypeId] })],
);
