CREATE TABLE "greenhero"."hotel_facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" smallint DEFAULT 1 NOT NULL,
	"name" varchar(120) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hotel_facilities_kind_check" CHECK ("greenhero"."hotel_facilities"."kind" in ('facility', 'service'))
);
--> statement-breakpoint
CREATE TABLE "greenhero"."hotel_info" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" varchar(160) NOT NULL,
	"short_description" varchar(300),
	"description" text,
	"address" text NOT NULL,
	"district" varchar(120),
	"city" varchar(120) NOT NULL,
	"province" varchar(120) NOT NULL,
	"postal_code" varchar(12),
	"google_maps_url" text,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"phone" varchar(30),
	"whatsapp_number" varchar(30),
	"email" varchar(254),
	"logo_url" text,
	"logo_public_id" text,
	"favicon_url" text,
	"favicon_public_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hotel_info_single_row_check" CHECK ("greenhero"."hotel_info"."id" = 1),
	CONSTRAINT "hotel_info_coordinates_check" CHECK (("greenhero"."hotel_info"."latitude" is null and "greenhero"."hotel_info"."longitude" is null) or ("greenhero"."hotel_info"."latitude" is not null and "greenhero"."hotel_info"."longitude" is not null and "greenhero"."hotel_info"."latitude" between -90 and 90 and "greenhero"."hotel_info"."longitude" between -180 and 180))
);
--> statement-breakpoint
ALTER TABLE "greenhero"."hotel_facilities" ADD CONSTRAINT "hotel_facilities_hotel_id_hotel_info_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "greenhero"."hotel_info"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hotel_facilities_hotel_kind_name_unique" ON "greenhero"."hotel_facilities" USING btree ("hotel_id","kind","name");
