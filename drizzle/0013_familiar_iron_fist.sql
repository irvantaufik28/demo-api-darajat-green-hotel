CREATE TABLE "greenhero"."gallery_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_url" text NOT NULL,
	"cloudinary_public_id" text,
	"category" varchar(20) NOT NULL,
	"title_id" varchar(160),
	"title_en" varchar(160),
	"caption_id" text,
	"caption_en" text,
	"alt_text_id" varchar(255) NOT NULL,
	"alt_text_en" varchar(255) NOT NULL,
	"show_on_homepage" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_images_category_check" CHECK ("greenhero"."gallery_images"."category" in ('rooms', 'pools', 'resort', 'dining', 'experiences', 'landscape')),
	CONSTRAINT "gallery_images_sort_order_check" CHECK ("greenhero"."gallery_images"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE INDEX "gallery_images_active_order_idx" ON "greenhero"."gallery_images" USING btree ("is_active","sort_order");--> statement-breakpoint
CREATE INDEX "gallery_images_category_idx" ON "greenhero"."gallery_images" USING btree ("category");