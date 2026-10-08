import { sql } from "drizzle-orm";
import { boolean, check, smallint, text, uuid, varchar } from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn, rupiah } from "./columns.js";
import { masterItems } from "./master_items.schema.js";

import { appSchema } from "./app-schema.js";

export const experiences = appSchema.table(
  "experiences",
  {
    id: idColumn(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => masterItems.id),
    code: varchar("code", { length: 120 }).notNull().unique(),
    slug: varchar("slug", { length: 120 }).notNull().unique(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    price: rupiah("price").notNull().default(0),
    maxQuantity: smallint("max_quantity").notNull().default(1),
    imageUrl: text("image_url"),
    coverImageUrl: text("cover_image_url"),
    isActive: boolean("is_active").notNull().default(true),
    ...auditTimestamps(),
  },
  (table) => [
    check(
      "experiences_price_quantity_check",
      sql`${table.price} >= 0 and ${table.maxQuantity} >= 1`,
    ),
  ],
);
