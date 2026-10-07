CREATE TABLE "greenhero"."room_maintenance_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_unit_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_maintenance_blocks_dates_check" CHECK ("greenhero"."room_maintenance_blocks"."end_date" > "greenhero"."room_maintenance_blocks"."start_date")
);
--> statement-breakpoint
ALTER TABLE "greenhero"."room_maintenance_blocks" ADD CONSTRAINT "room_maintenance_blocks_room_unit_id_room_units_id_fk" FOREIGN KEY ("room_unit_id") REFERENCES "greenhero"."room_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "greenhero"."room_maintenance_blocks" ADD CONSTRAINT "room_maintenance_blocks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "greenhero"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "greenhero"."room_maintenance_blocks" ADD CONSTRAINT "room_maintenance_blocks_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "greenhero"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_maintenance_blocks_unit_dates_idx" ON "greenhero"."room_maintenance_blocks" USING btree ("room_unit_id","start_date","end_date");