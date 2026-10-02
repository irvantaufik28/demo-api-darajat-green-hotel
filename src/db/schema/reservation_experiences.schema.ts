import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { idColumn, rupiah } from "./columns.js";
import { experiences } from "./experiences.schema.js";
import { reservations } from "./reservations.schema.js";

export const reservationExperiences = pgTable(
  "reservation_experiences",
  {
    id: idColumn(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    experienceId: uuid("experience_id")
      .notNull()
      .references(() => experiences.id),
    nameSnapshot: varchar("name_snapshot", { length: 160 }).notNull(),
    descriptionSnapshot: text("description_snapshot"),
    quantity: smallint("quantity").notNull().default(1),
    unitPrice: rupiah("unit_price").notNull().default(0),
    serviceDate: date("service_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("reservation_experiences_reservation_idx").on(table.reservationId),
    check(
      "reservation_experiences_values_check",
      sql`${table.quantity} >= 1 and ${table.unitPrice} >= 0`,
    ),
  ],
);
