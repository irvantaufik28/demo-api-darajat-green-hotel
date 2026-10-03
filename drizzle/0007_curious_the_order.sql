CREATE TABLE "greenhero"."reservation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" varchar(20) NOT NULL,
	"actor_user_id" uuid,
	"reservation_status_before" "greenhero"."reservation_status",
	"reservation_status_after" "greenhero"."reservation_status",
	"payment_status_before" "greenhero"."reservation_payment_status",
	"payment_status_after" "greenhero"."reservation_payment_status",
	"reference_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "reservation_events_actor_type_check" CHECK ("greenhero"."reservation_events"."actor_type" in ('user', 'system', 'gateway')),
	CONSTRAINT "reservation_events_actor_user_check" CHECK ("greenhero"."reservation_events"."actor_type" <> 'user' or "greenhero"."reservation_events"."actor_user_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "greenhero"."reservation_events" ADD CONSTRAINT "reservation_events_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "greenhero"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "greenhero"."reservation_events" ADD CONSTRAINT "reservation_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "greenhero"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reservation_events_reservation_time_idx" ON "greenhero"."reservation_events" USING btree ("reservation_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "reservation_events_actor_time_idx" ON "greenhero"."reservation_events" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE FUNCTION "greenhero"."reject_reservation_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'reservation_events is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "reservation_events_append_only_trigger"
BEFORE UPDATE OR DELETE ON "greenhero"."reservation_events"
FOR EACH ROW EXECUTE FUNCTION "greenhero"."reject_reservation_event_mutation"();
