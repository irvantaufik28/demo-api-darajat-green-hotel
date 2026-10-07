CREATE TABLE "greenhero"."payment_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"provider" varchar(20) DEFAULT 'xendit' NOT NULL,
	"reference_id" varchar(64) NOT NULL,
	"provider_session_id" varchar(160),
	"checkout_url" text,
	"amount" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'IDR' NOT NULL,
	"status" varchar(20) DEFAULT 'creating' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_sessions_reference_id_unique" UNIQUE("reference_id"),
	CONSTRAINT "payment_sessions_provider_session_id_unique" UNIQUE("provider_session_id"),
	CONSTRAINT "payment_sessions_values_check" CHECK ("greenhero"."payment_sessions"."amount" > 0 and "greenhero"."payment_sessions"."provider" = 'xendit' and "greenhero"."payment_sessions"."currency" = 'IDR' and "greenhero"."payment_sessions"."status" in ('creating', 'active', 'completed', 'expired', 'canceled', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "greenhero"."payment_webhook_events" ADD COLUMN "payment_session_id" uuid;--> statement-breakpoint
ALTER TABLE "greenhero"."payments" ADD COLUMN "payment_session_id" uuid;--> statement-breakpoint
ALTER TABLE "greenhero"."payment_sessions" ADD CONSTRAINT "payment_sessions_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "greenhero"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_sessions_reservation_created_idx" ON "greenhero"."payment_sessions" USING btree ("reservation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_sessions_one_active_per_reservation_uq" ON "greenhero"."payment_sessions" USING btree ("reservation_id") WHERE "greenhero"."payment_sessions"."status" in ('creating', 'active');--> statement-breakpoint
ALTER TABLE "greenhero"."payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_payment_session_id_payment_sessions_id_fk" FOREIGN KEY ("payment_session_id") REFERENCES "greenhero"."payment_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "greenhero"."payments" ADD CONSTRAINT "payments_payment_session_id_payment_sessions_id_fk" FOREIGN KEY ("payment_session_id") REFERENCES "greenhero"."payment_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_session_idx" ON "greenhero"."payments" USING btree ("payment_session_id");