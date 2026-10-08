ALTER TABLE "greenhero"."master_items" ADD COLUMN "icon_key" varchar(60);
--> statement-breakpoint
UPDATE "greenhero"."master_items"
SET "icon_key" = CASE "code"
  WHEN 'air_conditioning' THEN 'snowflake'
  WHEN 'mountain_view' THEN 'mountain'
  WHEN 'fireplace' THEN 'flame'
  WHEN 'hot_water' THEN 'flame'
  WHEN 'shower' THEN 'shower-head'
  WHEN 'bathtub' THEN 'bath'
  WHEN 'wifi' THEN 'wifi'
  WHEN 'television' THEN 'tv'
  WHEN 'cable_channels' THEN 'tv'
  WHEN 'smart_tv_streaming' THEN 'tv'
  WHEN 'kettle' THEN 'coffee'
  WHEN 'tea_coffee_set' THEN 'coffee'
  ELSE NULL
END
WHERE "category" = 'amenities' AND "icon_key" IS NULL;
