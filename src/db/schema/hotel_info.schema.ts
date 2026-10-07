import { sql } from "drizzle-orm";
import { check, decimal, smallint, text, varchar } from "drizzle-orm/pg-core";
import { auditTimestamps } from "./columns.js";
import { appSchema } from "./app-schema.js";

export const hotelInfo = appSchema.table(
  "hotel_info",
  {
    id: smallint("id").primaryKey().default(1),
    name: varchar("name", { length: 160 }).notNull(),
    shortDescription: varchar("short_description", { length: 300 }),
    description: text("description"),
    address: text("address").notNull(),
    district: varchar("district", { length: 120 }),
    city: varchar("city", { length: 120 }).notNull(),
    province: varchar("province", { length: 120 }).notNull(),
    postalCode: varchar("postal_code", { length: 12 }),
    googleMapsUrl: text("google_maps_url"),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    phone: varchar("phone", { length: 30 }),
    whatsappNumber: varchar("whatsapp_number", { length: 30 }),
    email: varchar("email", { length: 254 }),
    logoUrl: text("logo_url"),
    logoPublicId: text("logo_public_id"),
    faviconUrl: text("favicon_url"),
    faviconPublicId: text("favicon_public_id"),
    ...auditTimestamps(),
  },
  (table) => [
    check("hotel_info_single_row_check", sql`${table.id} = 1`),
    check(
      "hotel_info_coordinates_check",
      sql`(${table.latitude} is null and ${table.longitude} is null) or (${table.latitude} is not null and ${table.longitude} is not null and ${table.latitude} between -90 and 90 and ${table.longitude} between -180 and 180)`,
    ),
  ],
);
