import { boolean, index, integer, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn } from "./columns.js";

import { appSchema } from "./app-schema.js";

export const masterItems = appSchema.table(
  "master_items",
  {
    id: idColumn(),
    category: varchar("category", { length: 60 }).notNull(),
    code: varchar("code", { length: 80 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    iconKey: varchar("icon_key", { length: 60 }),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("master_items_category_code_uq").on(table.category, table.code),
    index("master_items_category_idx").on(table.category),
  ],
);
