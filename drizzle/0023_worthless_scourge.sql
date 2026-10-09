ALTER TABLE "greenhero"."reservation_settings" DROP CONSTRAINT "reservation_settings_values_check";--> statement-breakpoint
ALTER TABLE "greenhero"."reservation_settings" ALTER COLUMN "no_show_mode" SET DEFAULT 'automatic';--> statement-breakpoint
ALTER TABLE "greenhero"."reservation_settings" ADD COLUMN "no_show_cutoff_time" time DEFAULT '06:00' NOT NULL;--> statement-breakpoint
UPDATE "greenhero"."reservation_settings" SET "no_show_mode" = 'automatic' WHERE "id" = '00000000-0000-4000-8000-000000000001' AND "no_show_mode" = 'manual';--> statement-breakpoint
ALTER TABLE "greenhero"."reservation_settings" ADD CONSTRAINT "reservation_settings_values_check" CHECK ("greenhero"."reservation_settings"."website_payment_expiry_minutes" >= 11 and "greenhero"."reservation_settings"."no_show_mode" in ('manual', 'automatic'));
