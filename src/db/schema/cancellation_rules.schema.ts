import { sql } from "drizzle-orm";
import { check, integer, pgTable, smallint, uuid, varchar } from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn, rupiah } from "./columns.js";
import { cancellationPolicies } from "./cancellation_policies.schema.js";

export const cancellationRules = pgTable(
  "cancellation_rules",
  {
    id: idColumn(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => cancellationPolicies.id, { onDelete: "cascade" }),
    timingType: varchar("timing_type", { length: 20 }).notNull(),
    daysBefore: smallint("days_before").notNull(),
    chargeType: varchar("charge_type", { length: 20 }).notNull(),
    chargeValue: rupiah("charge_value").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    ...auditTimestamps(),
  },
  (table) => [
    check(
      "cancellation_rules_values_check",
      sql`${table.daysBefore} >= 0 and ${table.chargeValue} >= 0 and ${table.timingType} in ('more_than', 'within') and ${table.chargeType} in ('percentage', 'fixed', 'nights')`,
    ),
  ],
);
