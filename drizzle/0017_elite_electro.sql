WITH ranked AS (
  SELECT link.policy_id, link.room_type_id,
    row_number() OVER (
      PARTITION BY link.room_type_id
      ORDER BY
        CASE WHEN EXISTS (
          SELECT 1 FROM "greenhero"."campaigns" campaign
          WHERE campaign.cancellation_policy_id = policy.id AND campaign.is_active
        ) THEN 0 ELSE 1 END,
        policy.created_at DESC,
        policy.id DESC
    ) AS priority
  FROM "greenhero"."cancellation_policy_room_types" link
  JOIN "greenhero"."cancellation_policies" policy ON policy.id = link.policy_id
)
DELETE FROM "greenhero"."cancellation_policy_room_types" link
USING ranked
WHERE link.policy_id = ranked.policy_id
  AND link.room_type_id = ranked.room_type_id
  AND ranked.priority > 1;
--> statement-breakpoint
UPDATE "greenhero"."cancellation_policies" policy
SET is_active = false, updated_at = now()
WHERE NOT EXISTS (
  SELECT 1 FROM "greenhero"."cancellation_policy_room_types" link
  WHERE link.policy_id = policy.id
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cancellation_policy_room_types_room_type_uq" ON "greenhero"."cancellation_policy_room_types" USING btree ("room_type_id");
