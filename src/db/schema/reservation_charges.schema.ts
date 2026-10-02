import { sql } from "drizzle-orm";
import { check, date, index, numeric, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { idColumn, rupiah } from "./columns.js";
import { reservationRooms } from "./reservation_rooms.schema.js";
import { reservations } from "./reservations.schema.js";
import { users } from "./users.schema.js";

import { appSchema } from "./app-schema.js";

export const reservationCharges = appSchema.table(
  "reservation_charges",
  {
    id: idColumn(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id),
    reservationRoomId: uuid("reservation_room_id").references(() => reservationRooms.id),
    kind: varchar("kind", { length: 30 }).notNull(),
    sourceId: uuid("source_id"),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
    unitAmount: rupiah("unit_amount").notNull().default(0),
    amount: rupiah("amount").notNull().default(0),
    serviceDate: date("service_date"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("reservation_charges_reservation_idx").on(table.reservationId),
    check(
      "reservation_charges_kind_check",
      sql`${table.kind} in ('room', 'extra_bed', 'experience', 'breakfast', 'room_change', 'extension', 'cancellation', 'adjustment')`,
    ),
    check("reservation_charges_quantity_check", sql`${table.quantity} > 0`),
  ],
);
