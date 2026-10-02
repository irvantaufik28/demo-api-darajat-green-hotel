import { sql } from "drizzle-orm";
import { check, pgTable, primaryKey, smallint, uuid } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns.schema.js";

export const campaignDays = pgTable(
  "campaign_days",
  {
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.campaignId, table.weekday] }),
    check("campaign_days_weekday_check", sql`${table.weekday} between 1 and 7`),
  ],
);
