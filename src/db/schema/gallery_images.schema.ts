import { sql } from "drizzle-orm";
import { boolean, check, index, integer, text, varchar } from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn } from "./columns.js";
import { appSchema } from "./app-schema.js";

export const galleryImages = appSchema.table(
  "gallery_images",
  {
    id: idColumn(),
    imageUrl: text("image_url").notNull(),
    cloudinaryPublicId: text("cloudinary_public_id"),
    category: varchar("category", { length: 20 }).notNull(),
    titleId: varchar("title_id", { length: 160 }),
    titleEn: varchar("title_en", { length: 160 }),
    captionId: text("caption_id"),
    captionEn: text("caption_en"),
    altTextId: varchar("alt_text_id", { length: 255 }).notNull(),
    altTextEn: varchar("alt_text_en", { length: 255 }).notNull(),
    showOnHomepage: boolean("show_on_homepage").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...auditTimestamps(),
  },
  (table) => [
    check(
      "gallery_images_category_check",
      sql`${table.category} in ('rooms', 'pools', 'resort', 'dining', 'experiences', 'landscape')`,
    ),
    check("gallery_images_sort_order_check", sql`${table.sortOrder} >= 0`),
    index("gallery_images_active_order_idx").on(table.isActive, table.sortOrder),
    index("gallery_images_category_idx").on(table.category),
  ],
);
