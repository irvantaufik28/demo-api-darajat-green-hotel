CREATE TABLE "greenhero"."featured_room_types" (
	"room_type_id" uuid PRIMARY KEY NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "featured_room_types_sort_order_check" CHECK ("greenhero"."featured_room_types"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "greenhero"."featured_room_types" ADD CONSTRAINT "featured_room_types_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "greenhero"."room_types"("id") ON DELETE cascade ON UPDATE no action;