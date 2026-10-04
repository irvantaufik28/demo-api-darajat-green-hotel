ALTER TABLE "greenhero"."reservation_room_nights" ADD COLUMN "campaign_snapshot" jsonb;--> statement-breakpoint
UPDATE "greenhero"."reservation_room_nights" AS night
SET "campaign_snapshot" = jsonb_build_object(
  'id', campaign."id",
  'name', campaign."name",
  'promoCode', campaign."promo_code",
  'channel', campaign."channel",
  'discountType', campaign."discount_type",
  'discountValue', campaign."discount_value",
  'priority', campaign."priority",
  'bookingStart', campaign."booking_start",
  'bookingEnd', campaign."booking_end",
  'stayStart', campaign."stay_start",
  'stayEnd', campaign."stay_end"
)
FROM "greenhero"."campaigns" AS campaign
WHERE night."campaign_id" = campaign."id";--> statement-breakpoint
ALTER TABLE "greenhero"."reservation_room_nights" DROP CONSTRAINT "reservation_room_nights_campaign_id_campaigns_id_fk";--> statement-breakpoint
ALTER TABLE "greenhero"."reservation_room_nights" DROP COLUMN "campaign_id";
