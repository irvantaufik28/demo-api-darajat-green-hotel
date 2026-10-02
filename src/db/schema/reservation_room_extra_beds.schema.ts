import { sql } from "drizzle-orm";
import { check, date, pgTable, smallint, uuid } from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn, rupiah } from "./columns.js";
import { reservationRooms } from "./reservation_rooms.schema.js";

export const reservationRoomExtraBeds = pgTable(
  "reservation_room_extra_beds",
  {
    id: idColumn(),
    reservationRoomId: uuid("reservation_room_id")
      .notNull()
      .references(() => reservationRooms.id, { onDelete: "cascade" }),
    quantity: smallint("quantity").notNull().default(1),
    dateFrom: date("date_from").notNull(),
    dateTo: date("date_to").notNull(),
    unitPricePerNight: rupiah("unit_price_per_night").notNull().default(0),
    ...auditTimestamps(),
  },
  (table) => [
    check(
      "reservation_room_extra_beds_values_check",
      sql`${table.quantity} >= 1 and ${table.dateTo} > ${table.dateFrom} and ${table.unitPricePerNight} >= 0`,
    ),
  ],
);
