import { sql } from "drizzle-orm";
import { check, primaryKey, uuid, varchar } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns.schema.js";

import { appSchema } from "./app-schema.js";

export const campaignSources = appSchema.table(
  "campaign_sources",
  {
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 20 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.campaignId, table.source] }),
    check(
      "campaign_sources_source_check",
      sql`${table.source} in ('website', 'phone', 'walk_in', 'ota')`,
    ),
  ],
);
