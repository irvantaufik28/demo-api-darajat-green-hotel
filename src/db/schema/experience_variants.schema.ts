import { sql } from "drizzle-orm";
import { check, integer, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn, rupiah } from "./columns.js";
import { experiences } from "./experiences.schema.js";
import { appSchema } from "./app-schema.js";

export const experienceVariants = appSchema.table(
  "experience_variants",
  {
    id: idColumn(),
    experienceId: uuid("experience_id")
      .notNull()
      .references(() => experiences.id, { onDelete: "cascade" }),
    subName: varchar("sub_name", { length: 160 }).notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    price: rupiah("price").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("experience_variants_experience_sub_name_uq").on(table.experienceId, table.subName),
    check("experience_variants_price_check", sql`${table.price} >= 0`),
  ],
);
