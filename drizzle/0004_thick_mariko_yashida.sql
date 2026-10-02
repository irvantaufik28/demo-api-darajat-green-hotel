CREATE TABLE "greenhero"."experience_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experience_id" uuid NOT NULL,
	"sub_name" varchar(160) NOT NULL,
	"description" text,
	"price" bigint NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experience_variants_price_check" CHECK ("greenhero"."experience_variants"."price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "greenhero"."experience_variants" ADD CONSTRAINT "experience_variants_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "greenhero"."experiences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "experience_variants_experience_sub_name_uq" ON "greenhero"."experience_variants" USING btree ("experience_id","sub_name");