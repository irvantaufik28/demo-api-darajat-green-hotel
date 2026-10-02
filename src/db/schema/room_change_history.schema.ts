import { index, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn, rupiah } from "./columns.js";
import { reservationRooms } from "./reservation_rooms.schema.js";
import { roomTypes } from "./room_types.schema.js";
import { roomUnits } from "./room_units.schema.js";
import { users } from "./users.schema.js";

import { appSchema } from "./app-schema.js";

export const roomChangeHistory = appSchema.table(
  "room_change_history",
  {
    id: idColumn(),
    reservationRoomId: uuid("reservation_room_id")
      .notNull()
      .references(() => reservationRooms.id),
    fromRoomTypeId: uuid("from_room_type_id").references(() => roomTypes.id),
    toRoomTypeId: uuid("to_room_type_id").references(() => roomTypes.id),
    fromRoomUnitId: uuid("from_room_unit_id").references(() => roomUnits.id),
    toRoomUnitId: uuid("to_room_unit_id").references(() => roomUnits.id),
    priceDifference: rupiah("price_difference").notNull().default(0),
    reason: text("reason"),
    changedByUserId: uuid("changed_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("room_change_history_reservation_room_idx").on(table.reservationRoomId)],
);
