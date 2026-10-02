import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn, rupiah } from "./columns.js";
import { masterItems } from "./master_items.schema.js";
import { reservations } from "./reservations.schema.js";
import { users } from "./users.schema.js";

import { appSchema } from "./app-schema.js";

export const payments = appSchema.table(
  "payments",
  {
    id: idColumn(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id),
    methodId: uuid("method_id")
      .notNull()
      .references(() => masterItems.id),
    provider: varchar("provider", { length: 80 }),
    providerReference: varchar("provider_reference", { length: 160 }),
    amount: rupiah("amount").notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id),
    notes: text("notes"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).unique(),
    version: integer("version").notNull().default(1),
    ...auditTimestamps(),
  },
  (table) => [
    index("payments_reservation_idx").on(table.reservationId),
    index("payments_provider_reference_idx").on(table.providerReference),
    uniqueIndex("payments_provider_reference_uq")
      .on(table.provider, table.providerReference)
      .where(sql`${table.providerReference} is not null`),
    check(
      "payments_amount_status_check",
      sql`${table.amount} > 0 and ${table.version} >= 1 and ${table.status} in ('pending', 'succeeded', 'failed', 'expired', 'refunded', 'partially_refunded')`,
    ),
  ],
);
