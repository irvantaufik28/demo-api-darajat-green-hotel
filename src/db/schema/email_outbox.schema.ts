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
import { appSchema } from "./app-schema.js";
import { auditTimestamps, idColumn } from "./columns.js";
import { reservations } from "./reservations.schema.js";

export const emailOutbox = appSchema.table(
  "email_outbox",
  {
    id: idColumn(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id),
    template: varchar("template", { length: 40 }).notNull(),
    recipient: varchar("recipient", { length: 255 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    lastError: text("last_error"),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("email_outbox_reservation_template_uq").on(table.reservationId, table.template),
    index("email_outbox_delivery_idx").on(table.status, table.availableAt),
    check(
      "email_outbox_values_check",
      sql`${table.template} in ('reservation_voucher') and ${table.status} in ('pending', 'processing', 'sent', 'failed') and ${table.attemptCount} >= 0`,
    ),
  ],
);
