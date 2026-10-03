import { sql } from "drizzle-orm";
import { bigserial, check, index, jsonb, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { idColumn } from "./columns.js";
import { reservations } from "./reservations.schema.js";
import { reservationPaymentStatusEnum, reservationStatusEnum } from "./status.enums.js";
import { users } from "./users.schema.js";

import { appSchema } from "./app-schema.js";

export const reservationEvents = appSchema.table(
  "reservation_events",
  {
    id: idColumn(),
    sequence: bigserial("sequence", { mode: "number" }).notNull(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorType: varchar("actor_type", { length: 20 }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    reservationStatusBefore: reservationStatusEnum("reservation_status_before"),
    reservationStatusAfter: reservationStatusEnum("reservation_status_after"),
    paymentStatusBefore: reservationPaymentStatusEnum("payment_status_before"),
    paymentStatusAfter: reservationPaymentStatusEnum("payment_status_after"),
    referenceId: uuid("reference_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index("reservation_events_reservation_time_idx").on(table.reservationId, table.sequence),
    index("reservation_events_actor_time_idx").on(table.actorUserId, table.occurredAt),
    check(
      "reservation_events_actor_type_check",
      sql`${table.actorType} in ('user', 'system', 'gateway')`,
    ),
    check(
      "reservation_events_actor_user_check",
      sql`${table.actorType} <> 'user' or ${table.actorUserId} is not null`,
    ),
  ],
);
