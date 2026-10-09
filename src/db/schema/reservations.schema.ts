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
import { auditTimestamps, idColumn, rupiah } from "./columns.js";
import { guests } from "./guests.schema.js";
import { masterItems } from "./master_items.schema.js";
import { users } from "./users.schema.js";
import { reservationPaymentStatusEnum, reservationStatusEnum } from "./status.enums.js";

import { appSchema } from "./app-schema.js";

export const reservations = appSchema.table(
  "reservations",
  {
    id: idColumn(),
    bookingCode: varchar("booking_code", { length: 40 }).notNull().unique(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }),
    idempotencyRequestHash: varchar("idempotency_request_hash", { length: 64 }),
    createResponseSnapshot: jsonb("create_response_snapshot"),
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
    reservationStatus: reservationStatusEnum("reservation_status").notNull().default("pending"),
    paymentStatus: reservationPaymentStatusEnum("payment_status").notNull().default("unpaid"),
    specialRequests: text("special_requests"),
    internalNotes: text("internal_notes"),
    // Historical identifier only; cancellation terms are read from the booking snapshot.
    cancellationPolicyId: uuid("cancellation_policy_id"),
    cancellationPolicySnapshot: jsonb("cancellation_policy_snapshot"),
    promoCodeSnapshot: varchar("promo_code_snapshot", { length: 80 }),
    paymentExpiresAt: timestamp("payment_expires_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    noShowAt: timestamp("no_show_at", { withTimezone: true }),
    noShowReason: text("no_show_reason"),
    noShowMarkedByUserId: uuid("no_show_marked_by_user_id").references(() => users.id),
    noShowChargeAmount: rupiah("no_show_charge_amount"),
    noShowSettlementSnapshot: jsonb("no_show_settlement_snapshot"),
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
    index("reservations_payment_status_idx").on(table.paymentStatus),
    index("reservations_guest_created_idx").on(table.guestId, table.createdAt),
    index("reservations_source_created_idx").on(table.source, table.createdAt),
    uniqueIndex("reservations_ota_reference_uq")
      .on(table.otaChannelId, table.externalReference)
      .where(sql`${table.externalReference} is not null`),
    uniqueIndex("reservations_idempotency_key_uq")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
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
  ],
);
