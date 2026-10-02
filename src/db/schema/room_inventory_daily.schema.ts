import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  smallint,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn, rupiah } from "./columns.js";
import { roomTypes } from "./room_types.schema.js";

import { appSchema } from "./app-schema.js";

export const roomInventoryDaily = appSchema.table(
  "room_inventory_daily",
  {
    id: idColumn(),
    roomTypeId: uuid("room_type_id")
      .notNull()
      .references(() => roomTypes.id),
    stayDate: date("stay_date").notNull(),
    basePrice: rupiah("base_price").notNull().default(0),
    sellableStock: smallint("sellable_stock").notNull().default(0),
    minNights: smallint("min_nights").notNull().default(1),
    stopSell: boolean("stop_sell").notNull().default(false),
    version: integer("version").notNull().default(1),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("room_inventory_daily_type_date_uq").on(table.roomTypeId, table.stayDate),
    index("room_inventory_daily_stay_date_idx").on(table.stayDate),
    check(
      "room_inventory_daily_values_check",
      sql`${table.basePrice} >= 0 and ${table.sellableStock} >= 0 and ${table.minNights} >= 1 and ${table.version} >= 1`,
    ),
  ],
);
