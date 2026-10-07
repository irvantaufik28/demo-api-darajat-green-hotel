UPDATE "greenhero"."reservation_settings"
SET "website_payment_expiry_minutes" = 10
WHERE "website_payment_expiry_minutes" < 10;
--> statement-breakpoint
ALTER TABLE "greenhero"."reservation_settings" DROP CONSTRAINT "reservation_settings_values_check";--> statement-breakpoint
ALTER TABLE "greenhero"."reservation_settings" ADD CONSTRAINT "reservation_settings_values_check" CHECK ("greenhero"."reservation_settings"."website_payment_expiry_minutes" >= 10 and "greenhero"."reservation_settings"."no_show_mode" = 'manual');