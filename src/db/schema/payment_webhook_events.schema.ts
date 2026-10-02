import { jsonb, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { idColumn } from "./columns.js";
import { payments } from "./payments.schema.js";

import { appSchema } from "./app-schema.js";

export const paymentWebhookEvents = appSchema.table(
  "payment_webhook_events",
  {
    id: idColumn(),
    provider: varchar("provider", { length: 80 }).notNull(),
    eventId: varchar("event_id", { length: 160 }).notNull(),
    paymentId: uuid("payment_id").references(() => payments.id),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    processingError: text("processing_error"),
  },
  (table) => [
    uniqueIndex("payment_webhook_events_provider_event_uq").on(table.provider, table.eventId),
  ],
);
