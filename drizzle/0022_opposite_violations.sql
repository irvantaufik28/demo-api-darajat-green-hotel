ALTER TYPE "greenhero"."reservation_status" ADD VALUE 'no_show' BEFORE 'cancelled';--> statement-breakpoint
ALTER TABLE "greenhero"."reservations" ADD COLUMN "no_show_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "greenhero"."reservations" ADD COLUMN "no_show_reason" text;--> statement-breakpoint
ALTER TABLE "greenhero"."reservations" ADD COLUMN "no_show_marked_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "greenhero"."reservations" ADD COLUMN "no_show_charge_amount" bigint;--> statement-breakpoint
ALTER TABLE "greenhero"."reservations" ADD COLUMN "no_show_settlement_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "greenhero"."reservations" ADD CONSTRAINT "reservations_no_show_marked_by_user_id_users_id_fk" FOREIGN KEY ("no_show_marked_by_user_id") REFERENCES "greenhero"."users"("id") ON DELETE no action ON UPDATE no action;