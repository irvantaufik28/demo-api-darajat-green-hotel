import { sql } from "drizzle-orm";
import { boolean, check, integer, smallint, uniqueIndex } from "drizzle-orm/pg-core";
import { appSchema } from "./app-schema.js";
import { auditTimestamps, idColumn } from "./columns.js";

export const capacityPatterns = appSchema.table(
  "capacity_patterns",
  {
    id: idColumn(),
    adults: smallint("adults").notNull(),
    children: smallint("children").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("capacity_patterns_combination_uq").on(table.adults, table.children),
    check("capacity_patterns_values_check", sql`${table.adults} >= 1 and ${table.children} >= 0`),
  ],
);
