import { sql } from "drizzle-orm";
import { boolean, check, date, uuid, varchar } from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn, rupiah } from "./columns.js";
import { masterItems } from "./master_items.schema.js";

import { appSchema } from "./app-schema.js";

export const cancellationPolicies = appSchema.table(
  "cancellation_policies",
  {
    id: idColumn(),
    name: varchar("name", { length: 160 }).notNull(),
    policyTypeId: uuid("policy_type_id").references(() => masterItems.id),
    appliesWebsite: boolean("applies_website").notNull().default(false),
    appliesPhone: boolean("applies_phone").notNull().default(false),
    stayStart: date("stay_start"),
    stayEnd: date("stay_end"),
    noShowChargeType: varchar("no_show_charge_type", { length: 30 }),
    noShowChargeValue: rupiah("no_show_charge_value").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...auditTimestamps(),
  },
  (table) => [
    check(
      "cancellation_policies_source_check",
      sql`${table.appliesWebsite} or ${table.appliesPhone}`,
    ),
    check(
      "cancellation_policies_dates_check",
      sql`${table.stayStart} is null or ${table.stayEnd} is null or ${table.stayEnd} >= ${table.stayStart}`,
    ),
    check(
      "cancellation_policies_no_show_check",
      sql`${table.noShowChargeValue} >= 0 and (${table.noShowChargeType} is null or ${table.noShowChargeType} in ('percentage', 'first_night', 'full_stay'))`,
    ),
  ],
);
