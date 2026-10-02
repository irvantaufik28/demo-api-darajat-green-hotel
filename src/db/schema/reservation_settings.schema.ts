import { sql } from "drizzle-orm";
import { boolean, check, smallint, time, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { idColumn } from "./columns.js";
import { users } from "./users.schema.js";

import { appSchema } from "./app-schema.js";

export const reservationSettings = appSchema.table(
  "reservation_settings",
  {
    id: idColumn(),
    checkInTime: time("check_in_time").notNull().default("14:00"),
    checkOutTime: time("check_out_time").notNull().default("12:00"),
    autoConfirmWebsiteAfterPayment: boolean("auto_confirm_website_after_payment")
      .notNull()
      .default(true),
    allowOutstandingCheckIn: boolean("allow_outstanding_check_in").notNull().default(true),
    allowOutstandingCheckOut: boolean("allow_outstanding_check_out").notNull().default(true),
    websitePaymentExpiryMinutes: smallint("website_payment_expiry_minutes").notNull().default(30),
    noShowMode: varchar("no_show_mode", { length: 20 }).notNull().default("manual"),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "reservation_settings_values_check",
      sql`${table.websitePaymentExpiryMinutes} >= 1 and ${table.noShowMode} = 'manual'`,
    ),
  ],
);
