CREATE TABLE "greenhero"."capacity_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"adults" smallint NOT NULL,
	"children" smallint DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capacity_patterns_values_check" CHECK ("greenhero"."capacity_patterns"."adults" >= 1 and "greenhero"."capacity_patterns"."children" >= 0)
);
--> statement-breakpoint
CREATE TABLE "greenhero"."room_type_capacity_patterns" (
	"room_type_id" uuid NOT NULL,
	"capacity_pattern_id" uuid NOT NULL,
	"extra_beds" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "room_type_capacity_patterns_room_type_id_capacity_pattern_id_pk" PRIMARY KEY("room_type_id","capacity_pattern_id"),
	CONSTRAINT "room_type_capacity_patterns_extra_beds_check" CHECK ("greenhero"."room_type_capacity_patterns"."extra_beds" >= 0)
);
--> statement-breakpoint
ALTER TABLE "greenhero"."room_types" DROP CONSTRAINT "room_types_capacity_check";--> statement-breakpoint
ALTER TABLE "greenhero"."room_type_capacity_patterns" ADD CONSTRAINT "room_type_capacity_patterns_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "greenhero"."room_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "greenhero"."room_type_capacity_patterns" ADD CONSTRAINT "room_type_capacity_patterns_capacity_pattern_id_capacity_patterns_id_fk" FOREIGN KEY ("capacity_pattern_id") REFERENCES "greenhero"."capacity_patterns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capacity_patterns_combination_uq" ON "greenhero"."capacity_patterns" USING btree ("adults","children");--> statement-breakpoint
ALTER TABLE "greenhero"."room_types" DROP COLUMN "base_adults";--> statement-breakpoint
ALTER TABLE "greenhero"."room_types" DROP COLUMN "base_children";--> statement-breakpoint
ALTER TABLE "greenhero"."room_types" DROP COLUMN "max_adults";--> statement-breakpoint
ALTER TABLE "greenhero"."room_types" DROP COLUMN "max_children";--> statement-breakpoint
ALTER TABLE "greenhero"."room_types" ADD CONSTRAINT "room_types_capacity_check" CHECK ("greenhero"."room_types"."bed_count" >= 1 and "greenhero"."room_types"."max_extra_beds" >= 0);