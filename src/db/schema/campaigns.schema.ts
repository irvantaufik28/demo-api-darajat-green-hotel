import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  integer,
  pgTable,
  smallint,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn, rupiah } from "./columns.js";
import { cancellationPolicies } from "./cancellation_policies.schema.js";

export const campaigns = pgTable(
  "campaigns",
  {
    id: idColumn(),
    name: varchar("name", { length: 160 }).notNull(),
    promoCode: varchar("promo_code", { length: 80 }).unique(),
    requiresCode: boolean("requires_code").notNull().default(false),
    bookingStart: date("booking_start"),
    bookingEnd: date("booking_end"),
    stayStart: date("stay_start"),
    stayEnd: date("stay_end"),
    discountType: varchar("discount_type", { length: 20 }).notNull(),
    discountValue: rupiah("discount_value").notNull().default(0),
    minNights: smallint("min_nights").notNull().default(1),
    minRooms: smallint("min_rooms").notNull().default(1),
    priority: integer("priority").notNull().default(0),
    cancellationPolicyId: uuid("cancellation_policy_id").references(() => cancellationPolicies.id),
    isActive: boolean("is_active").notNull().default(true),
    ...auditTimestamps(),
  },
  (table) => [
    check(
      "campaigns_values_check",
      sql`${table.discountType} in ('percent', 'fixed') and ${table.discountValue} >= 0 and ${table.minNights} >= 1 and ${table.minRooms} >= 1`,
    ),
    check(
      "campaigns_booking_dates_check",
      sql`${table.bookingStart} is null or ${table.bookingEnd} is null or ${table.bookingEnd} >= ${table.bookingStart}`,
    ),
    check(
      "campaigns_stay_dates_check",
      sql`${table.stayStart} is null or ${table.stayEnd} is null or ${table.stayEnd} >= ${table.stayStart}`,
    ),
    check("campaigns_code_check", sql`not ${table.requiresCode} or ${table.promoCode} is not null`),
  ],
);
