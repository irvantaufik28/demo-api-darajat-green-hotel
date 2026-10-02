WITH ranked AS (
	SELECT "id", row_number() OVER (ORDER BY "priority", "created_at", "id")::integer AS "position"
	FROM "greenhero"."campaigns"
)
UPDATE "greenhero"."campaigns" AS campaign
SET "priority" = ranked."position"
FROM ranked
WHERE campaign."id" = ranked."id";
--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_priority_uq" ON "greenhero"."campaigns" USING btree ("priority");
