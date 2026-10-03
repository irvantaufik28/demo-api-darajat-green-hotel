DROP INDEX "greenhero"."reservation_events_reservation_time_idx";--> statement-breakpoint
ALTER TABLE "greenhero"."reservation_events" ADD COLUMN "sequence" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "greenhero"."reservations" ADD COLUMN "idempotency_key" varchar(160);--> statement-breakpoint
ALTER TABLE "greenhero"."reservations" ADD COLUMN "idempotency_request_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "greenhero"."reservations" ADD COLUMN "create_response_snapshot" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_idempotency_key_uq" ON "greenhero"."reservations" USING btree ("idempotency_key") WHERE "greenhero"."reservations"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "reservation_events_reservation_time_idx" ON "greenhero"."reservation_events" USING btree ("reservation_id","sequence");