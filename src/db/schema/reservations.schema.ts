import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn } from "./columns.js";
import { cancellationPolicies } from "./cancellation_policies.schema.js";
import { guests } from "./guests.schema.js";
import { masterItems } from "./master_items.schema.js";
import { users } from "./users.schema.js";

import { appSchema } from "./app-schema.js";

export const reservations = appSchema.table(
  "reservations",
  {
    id: idColumn(),
    bookingCode: varchar("booking_code", { length: 40 }).notNull().unique(),
    guestId: uuid("guest_id")
      .notNull()
      .references(() => guests.id),
    source: varchar("source", { length: 20 }).notNull(),
    otaChannelId: uuid("ota_channel_id").references(() => masterItems.id),
    externalReference: varchar("external_reference", { length: 120 }),
    checkInDate: date("check_in_date").notNull(),
    checkOutDate: date("check_out_date").notNull(),
    adults: smallint("adults").notNull().default(0),
    children: smallint("children").notNull().default(0),
    reservationStatus: varchar("reservation_status", { length: 25 }).notNull().default("pending"),
    paymentStatus: varchar("payment_status", { length: 20 }).notNull().default("unpaid"),
    operationalStatus: varchar("operational_status", { length: 30 }),
    specialRequests: text("special_requests"),
    internalNotes: text("internal_notes"),
    cancellationPolicyId: uuid("cancellation_policy_id").references(() => cancellationPolicies.id),
    cancellationPolicySnapshot: jsonb("cancellation_policy_snapshot"),
    promoCodeSnapshot: varchar("promo_code_snapshot", { length: 80 }),
    paymentExpiresAt: timestamp("payment_expires_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    checkoutOutstandingReason: text("checkout_outstanding_reason"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    version: integer("version").notNull().default(1),
    ...auditTimestamps(),
  },
  (table) => [
    index("reservations_check_in_status_idx").on(table.checkInDate, table.reservationStatus),
    index("reservations_check_out_status_idx").on(table.checkOutDate, table.reservationStatus),
    index("reservations_operational_payment_idx").on(table.operationalStatus, table.paymentStatus),
    index("reservations_guest_created_idx").on(table.guestId, table.createdAt),
    index("reservations_source_created_idx").on(table.source, table.createdAt),
    uniqueIndex("reservations_ota_reference_uq")
      .on(table.otaChannelId, table.externalReference)
      .where(sql`${table.externalReference} is not null`),
    check(
      "reservations_dates_guests_check",
      sql`${table.checkOutDate} > ${table.checkInDate} and ${table.adults} >= 0 and ${table.children} >= 0 and ${table.version} >= 1`,
    ),
    check(
      "reservations_source_check",
      sql`${table.source} in ('website', 'phone', 'walk_in', 'ota')`,
    ),
    check(
      "reservations_ota_channel_check",
      sql`${table.source} <> 'ota' or ${table.otaChannelId} is not null`,
    ),
    check(
      "reservations_status_check",
      sql`${table.reservationStatus} in ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'expired')`,
    ),
    check(
      "reservations_payment_status_check",
      sql`${table.paymentStatus} in ('unpaid', 'partial', 'paid', 'failed', 'refunded', 'expired')`,
    ),
    check(
      "reservations_operational_status_check",
      sql`${table.operationalStatus} is null or ${table.operationalStatus} in ('awaiting_confirmation', 'upcoming', 'ready_to_check_in', 'checked_in', 'in_house', 'due_out', 'overdue', 'checked_out', 'cancelled', 'expired')`,
    ),
  ],
);
