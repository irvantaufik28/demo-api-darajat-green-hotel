import { sql } from "drizzle-orm";
import { check, index, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn, rupiah } from "./columns.js";
import { reservations } from "./reservations.schema.js";

import { appSchema } from "./app-schema.js";

export const paymentSessions = appSchema.table(
  "payment_sessions",
  {
    id: idColumn(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id),
    provider: varchar("provider", { length: 20 }).notNull().default("xendit"),
    referenceId: varchar("reference_id", { length: 64 }).notNull().unique(),
    providerSessionId: varchar("provider_session_id", { length: 160 }).unique(),
    checkoutUrl: text("checkout_url"),
    amount: rupiah("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("IDR"),
    status: varchar("status", { length: 20 }).notNull().default("creating"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...auditTimestamps(),
  },
  (table) => [
    index("payment_sessions_reservation_created_idx").on(table.reservationId, table.createdAt),
    uniqueIndex("payment_sessions_one_active_per_reservation_uq")
      .on(table.reservationId)
      .where(sql`${table.status} in ('creating', 'active')`),
    check(
      "payment_sessions_values_check",
      sql`${table.amount} > 0 and ${table.provider} = 'xendit' and ${table.currency} = 'IDR' and ${table.status} in ('creating', 'active', 'completed', 'expired', 'canceled', 'failed')`,
    ),
  ],
);
