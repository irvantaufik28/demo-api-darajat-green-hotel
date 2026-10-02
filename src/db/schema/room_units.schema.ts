import { sql } from "drizzle-orm";
import { boolean, check, index, uuid, varchar } from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn } from "./columns.js";
import { masterItems } from "./master_items.schema.js";
import { roomTypes } from "./room_types.schema.js";

import { appSchema } from "./app-schema.js";

export const roomUnits = appSchema.table(
  "room_units",
  {
    id: idColumn(),
    roomTypeId: uuid("room_type_id")
      .notNull()
      .references(() => roomTypes.id),
    roomNumber: varchar("room_number", { length: 30 }).notNull().unique(),
    floorId: uuid("floor_id").references(() => masterItems.id),
    bedConfiguration: varchar("bed_configuration", { length: 160 }),
    operationalStatus: varchar("operational_status", { length: 30 }).notNull().default("available"),
    isActive: boolean("is_active").notNull().default(true),
    ...auditTimestamps(),
  },
  (table) => [
    index("room_units_type_status_idx").on(table.roomTypeId, table.operationalStatus),
    check(
      "room_units_status_check",
      sql`${table.operationalStatus} in ('available', 'occupied', 'cleaning', 'maintenance', 'out_of_service')`,
    ),
  ],
);
