import { sql } from "drizzle-orm";
import { check, index, text, uuid, varchar } from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn, rupiah } from "./columns.js";
import { masterItems } from "./master_items.schema.js";
import { reservations } from "./reservations.schema.js";

import { appSchema } from "./app-schema.js";

export const reservationDeposits = appSchema.table(
  "reservation_deposits",
  {
    id: idColumn(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id),
    amountHeld: rupiah("amount_held").notNull().default(0),
    amountRefunded: rupiah("amount_refunded").notNull().default(0),
    amountDeducted: rupiah("amount_deducted").notNull().default(0),
    methodId: uuid("method_id").references(() => masterItems.id),
    status: varchar("status", { length: 20 }).notNull().default("held"),
    notes: text("notes"),
    ...auditTimestamps(),
  },
  (table) => [
    index("reservation_deposits_reservation_idx").on(table.reservationId),
    check(
      "reservation_deposits_amount_status_check",
      sql`${table.amountHeld} >= 0 and ${table.amountRefunded} >= 0 and ${table.amountDeducted} >= 0 and ${table.amountRefunded} + ${table.amountDeducted} <= ${table.amountHeld} and ${table.status} in ('held', 'partially_refunded', 'refunded', 'deducted')`,
    ),
  ],
);
