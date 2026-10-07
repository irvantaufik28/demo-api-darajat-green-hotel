import { sql } from "drizzle-orm";
import { check, date, index, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { auditTimestamps, idColumn } from "./columns.js";
import { appSchema } from "./app-schema.js";
import { roomUnits } from "./room_units.schema.js";
import { users } from "./users.schema.js";

export const roomMaintenanceBlocks = appSchema.table(
  "room_maintenance_blocks",
  {
    id: idColumn(),
    roomUnitId: uuid("room_unit_id")
      .notNull()
      .references(() => roomUnits.id),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    reason: text("reason").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledByUserId: uuid("cancelled_by_user_id").references(() => users.id),
    ...auditTimestamps(),
  },
  (table) => [
    index("room_maintenance_blocks_unit_dates_idx").on(
      table.roomUnitId,
      table.startDate,
      table.endDate,
    ),
    check("room_maintenance_blocks_dates_check", sql`${table.endDate} > ${table.startDate}`),
  ],
);
