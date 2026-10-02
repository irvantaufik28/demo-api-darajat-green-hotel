ALTER TABLE "greenhero"."campaigns" ADD COLUMN "channel" varchar(20) DEFAULT 'website' NOT NULL;--> statement-breakpoint
DROP INDEX "greenhero"."campaigns_priority_uq";--> statement-breakpoint
CREATE TEMP TABLE campaign_channel_copies (original_id uuid PRIMARY KEY, copy_id uuid NOT NULL);--> statement-breakpoint
INSERT INTO campaign_channel_copies (original_id, copy_id)
SELECT c.id, gen_random_uuid()
FROM "greenhero"."campaigns" c
WHERE EXISTS (SELECT 1 FROM "greenhero"."campaign_sources" s WHERE s.campaign_id = c.id AND s.source = 'website')
  AND EXISTS (SELECT 1 FROM "greenhero"."campaign_sources" s WHERE s.campaign_id = c.id AND s.source IN ('phone', 'walk_in'));--> statement-breakpoint
UPDATE "greenhero"."campaigns" c SET channel = 'front_desk'
WHERE NOT EXISTS (SELECT 1 FROM "greenhero"."campaign_sources" s WHERE s.campaign_id = c.id AND s.source = 'website')
  AND EXISTS (SELECT 1 FROM "greenhero"."campaign_sources" s WHERE s.campaign_id = c.id AND s.source IN ('phone', 'walk_in'));--> statement-breakpoint
UPDATE "greenhero"."campaigns" c SET is_active = false
WHERE NOT EXISTS (SELECT 1 FROM "greenhero"."campaign_sources" s WHERE s.campaign_id = c.id AND s.source IN ('website', 'phone', 'walk_in'));--> statement-breakpoint
INSERT INTO "greenhero"."campaigns" (id, name, promo_code, requires_code, booking_start, booking_end, stay_start, stay_end, discount_type, discount_value, min_nights, min_rooms, priority, cancellation_policy_id, is_active, created_at, updated_at, channel)
SELECT m.copy_id, c.name, CASE WHEN c.promo_code IS NULL THEN NULL ELSE left(c.promo_code, 63) || '-FD-' || left(m.copy_id::text, 12) END,
  c.requires_code, c.booking_start, c.booking_end, c.stay_start, c.stay_end, c.discount_type,
  c.discount_value, c.min_nights, c.min_rooms, c.priority, c.cancellation_policy_id,
  c.is_active, c.created_at, c.updated_at, 'front_desk'
FROM campaign_channel_copies m JOIN "greenhero"."campaigns" c ON c.id = m.original_id;--> statement-breakpoint
INSERT INTO "greenhero"."campaign_days" (campaign_id, weekday)
SELECT m.copy_id, d.weekday FROM campaign_channel_copies m JOIN "greenhero"."campaign_days" d ON d.campaign_id = m.original_id;--> statement-breakpoint
INSERT INTO "greenhero"."campaign_room_types" (campaign_id, room_type_id)
SELECT m.copy_id, r.room_type_id FROM campaign_channel_copies m JOIN "greenhero"."campaign_room_types" r ON r.campaign_id = m.original_id;--> statement-breakpoint
INSERT INTO "greenhero"."campaign_blackout_dates" (id, campaign_id, date_from, date_to, label, created_at)
SELECT gen_random_uuid(), m.copy_id, b.date_from, b.date_to, b.label, b.created_at
FROM campaign_channel_copies m JOIN "greenhero"."campaign_blackout_dates" b ON b.campaign_id = m.original_id;--> statement-breakpoint
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY channel ORDER BY priority, created_at, id)::integer AS position
  FROM "greenhero"."campaigns"
)
UPDATE "greenhero"."campaigns" c SET priority = ranked.position FROM ranked WHERE c.id = ranked.id;--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_channel_priority_uq" ON "greenhero"."campaigns" USING btree ("channel","priority");--> statement-breakpoint
ALTER TABLE "greenhero"."campaign_sources" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "greenhero"."campaign_sources" CASCADE;--> statement-breakpoint
DROP TABLE campaign_channel_copies;--> statement-breakpoint
ALTER TABLE "greenhero"."campaigns" ADD CONSTRAINT "campaigns_channel_check" CHECK ("greenhero"."campaigns"."channel" in ('website', 'front_desk'));
