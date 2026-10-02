import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  numeric,
  pgTable,
  smallint,
  text,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn, rupiah } from "./columns.js";
import { masterItems } from "./master_items.schema.js";

export const roomTypes = pgTable(
  "room_types",
  {
    id: idColumn(),
    code: varchar("code", { length: 40 }).notNull().unique(),
    slug: varchar("slug", { length: 120 }).notNull().unique(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    sizeSqm: numeric("size_sqm", { precision: 6, scale: 2 }),
    bedTypeId: uuid("bed_type_id").references(() => masterItems.id),
    mealTypeId: uuid("meal_type_id").references(() => masterItems.id),
    viewTypeId: uuid("view_type_id").references(() => masterItems.id),
    bedCount: smallint("bed_count").notNull().default(1),
    baseAdults: smallint("base_adults").notNull().default(0),
    baseChildren: smallint("base_children").notNull().default(0),
    maxAdults: smallint("max_adults").notNull().default(0),
    maxChildren: smallint("max_children").notNull().default(0),
    extraBedEnabled: boolean("extra_bed_enabled").notNull().default(false),
    maxExtraBeds: smallint("max_extra_beds").notNull().default(0),
    extraBedPricePerNight: rupiah("extra_bed_price_per_night").notNull().default(0),
    adultBreakfastPrice: rupiah("adult_breakfast_price").notNull().default(0),
    childBreakfastPrice: rupiah("child_breakfast_price").notNull().default(0),
    basePricePerNight: rupiah("base_price_per_night").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...auditTimestamps(),
  },
  (table) => [
    check(
      "room_types_capacity_check",
      sql`${table.bedCount} >= 1 and ${table.baseAdults} >= 0 and ${table.baseChildren} >= 0 and ${table.maxAdults} >= ${table.baseAdults} and ${table.maxChildren} >= ${table.baseChildren} and ${table.maxExtraBeds} >= 0`,
    ),
    check(
      "room_types_prices_check",
      sql`${table.extraBedPricePerNight} >= 0 and ${table.adultBreakfastPrice} >= 0 and ${table.childBreakfastPrice} >= 0 and ${table.basePricePerNight} >= 0`,
    ),
  ],
);
