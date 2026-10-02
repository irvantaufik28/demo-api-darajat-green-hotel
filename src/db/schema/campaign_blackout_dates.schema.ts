import { sql } from "drizzle-orm";
import { check, date, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { idColumn } from "./columns.js";
import { campaigns } from "./campaigns.schema.js";

export const campaignBlackoutDates = pgTable(
  "campaign_blackout_dates",
  {
    id: idColumn(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    dateFrom: date("date_from").notNull(),
    dateTo: date("date_to").notNull(),
    label: varchar("label", { length: 160 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("campaign_blackout_dates_range_check", sql`${table.dateTo} >= ${table.dateFrom}`),
  ],
);
