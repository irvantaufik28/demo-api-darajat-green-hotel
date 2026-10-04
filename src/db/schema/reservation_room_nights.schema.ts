import { sql } from "drizzle-orm";
import { check, date, jsonb, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { idColumn, rupiah } from "./columns.js";
import { reservationRooms } from "./reservation_rooms.schema.js";

import { appSchema } from "./app-schema.js";

export type ReservationCampaignSnapshot = {
  id: string;
  name: string;
  promoCode: string | null;
  channel: string;
  discountType: string;
  discountValue: number;
  priority: number;
  bookingStart: string | null;
  bookingEnd: string | null;
  stayStart: string | null;
  stayEnd: string | null;
};

export const reservationRoomNights = appSchema.table(
  "reservation_room_nights",
  {
    id: idColumn(),
    reservationRoomId: uuid("reservation_room_id")
      .notNull()
      .references(() => reservationRooms.id, { onDelete: "cascade" }),
    stayDate: date("stay_date").notNull(),
    basePrice: rupiah("base_price").notNull().default(0),
    discountAmount: rupiah("discount_amount").notNull().default(0),
    finalPrice: rupiah("final_price").notNull().default(0),
    campaignSnapshot: jsonb("campaign_snapshot").$type<ReservationCampaignSnapshot>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("reservation_room_nights_room_date_uq").on(table.reservationRoomId, table.stayDate),
    check(
      "reservation_room_nights_prices_check",
      sql`${table.basePrice} >= 0 and ${table.discountAmount} >= 0 and ${table.finalPrice} >= 0 and ${table.finalPrice} = ${table.basePrice} - ${table.discountAmount}`,
    ),
  ],
);
