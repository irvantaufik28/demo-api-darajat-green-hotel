import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { idColumn, rupiah } from "./columns.js";
import { payments } from "./payments.schema.js";
import { users } from "./users.schema.js";

export const paymentRefunds = pgTable(
  "payment_refunds",
  {
    id: idColumn(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    amount: rupiah("amount").notNull(),
    reason: text("reason"),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    providerReference: varchar("provider_reference", { length: 160 }),
    processedByUserId: uuid("processed_by_user_id").references(() => users.id),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("payment_refunds_payment_idx").on(table.paymentId),
    check(
      "payment_refunds_amount_status_check",
      sql`${table.amount} > 0 and ${table.status} in ('pending', 'succeeded', 'failed')`,
    ),
  ],
);
