CREATE TABLE "greenhero"."email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"template" varchar(40) NOT NULL,
	"recipient" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"provider_message_id" varchar(255),
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_values_check" CHECK ("greenhero"."email_outbox"."template" in ('reservation_voucher') and "greenhero"."email_outbox"."status" in ('pending', 'processing', 'sent', 'failed') and "greenhero"."email_outbox"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "greenhero"."email_outbox" ADD CONSTRAINT "email_outbox_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "greenhero"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_reservation_template_uq" ON "greenhero"."email_outbox" USING btree ("reservation_id","template");--> statement-breakpoint
CREATE INDEX "email_outbox_delivery_idx" ON "greenhero"."email_outbox" USING btree ("status","available_at");