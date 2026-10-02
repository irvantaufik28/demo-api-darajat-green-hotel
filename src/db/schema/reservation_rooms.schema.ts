import { sql } from "drizzle-orm";
import { check, index, pgTable, smallint, uuid, varchar } from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn } from "./columns.js";
import { reservations } from "./reservations.schema.js";
import { roomTypes } from "./room_types.schema.js";
import { roomUnits } from "./room_units.schema.js";

export const reservationRooms = pgTable(
  "reservation_rooms",
  {
    id: idColumn(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    roomTypeId: uuid("room_type_id")
      .notNull()
      .references(() => roomTypes.id),
    roomUnitId: uuid("room_unit_id").references(() => roomUnits.id),
    roomTypeNameSnapshot: varchar("room_type_name_snapshot", {
      length: 160,
    }).notNull(),
    adults: smallint("adults").notNull().default(0),
    children: smallint("children").notNull().default(0),
    bedConfigurationSnapshot: varchar("bed_configuration_snapshot", {
      length: 160,
    }),
    ...auditTimestamps(),
  },
  (table) => [
    index("reservation_rooms_reservation_idx").on(table.reservationId),
    index("reservation_rooms_unit_reservation_idx").on(table.roomUnitId, table.reservationId),
    check("reservation_rooms_guests_check", sql`${table.adults} >= 0 and ${table.children} >= 0`),
  ],
);
