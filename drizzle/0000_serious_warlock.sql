CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" varchar(80) NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_blackout_dates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"label" varchar(160),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_blackout_dates_range_check" CHECK ("campaign_blackout_dates"."date_to" >= "campaign_blackout_dates"."date_from")
);
--> statement-breakpoint
CREATE TABLE "campaign_days" (
	"campaign_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	CONSTRAINT "campaign_days_campaign_id_weekday_pk" PRIMARY KEY("campaign_id","weekday"),
	CONSTRAINT "campaign_days_weekday_check" CHECK ("campaign_days"."weekday" between 1 and 7)
);
--> statement-breakpoint
CREATE TABLE "campaign_room_types" (
	"campaign_id" uuid NOT NULL,
	"room_type_id" uuid NOT NULL,
	CONSTRAINT "campaign_room_types_campaign_id_room_type_id_pk" PRIMARY KEY("campaign_id","room_type_id")
);
--> statement-breakpoint
CREATE TABLE "campaign_sources" (
	"campaign_id" uuid NOT NULL,
	"source" varchar(20) NOT NULL,
	CONSTRAINT "campaign_sources_campaign_id_source_pk" PRIMARY KEY("campaign_id","source"),
	CONSTRAINT "campaign_sources_source_check" CHECK ("campaign_sources"."source" in ('website', 'phone', 'walk_in', 'ota'))
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"promo_code" varchar(80),
	"requires_code" boolean DEFAULT false NOT NULL,
	"booking_start" date,
	"booking_end" date,
	"stay_start" date,
	"stay_end" date,
	"discount_type" varchar(20) NOT NULL,
	"discount_value" bigint DEFAULT 0 NOT NULL,
	"min_nights" smallint DEFAULT 1 NOT NULL,
	"min_rooms" smallint DEFAULT 1 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"cancellation_policy_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_promo_code_unique" UNIQUE("promo_code"),
	CONSTRAINT "campaigns_values_check" CHECK ("campaigns"."discount_type" in ('percent', 'fixed') and "campaigns"."discount_value" >= 0 and "campaigns"."min_nights" >= 1 and "campaigns"."min_rooms" >= 1),
	CONSTRAINT "campaigns_booking_dates_check" CHECK ("campaigns"."booking_start" is null or "campaigns"."booking_end" is null or "campaigns"."booking_end" >= "campaigns"."booking_start"),
	CONSTRAINT "campaigns_stay_dates_check" CHECK ("campaigns"."stay_start" is null or "campaigns"."stay_end" is null or "campaigns"."stay_end" >= "campaigns"."stay_start"),
	CONSTRAINT "campaigns_code_check" CHECK (not "campaigns"."requires_code" or "campaigns"."promo_code" is not null)
);
--> statement-breakpoint
CREATE TABLE "cancellation_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"policy_type_id" uuid,
	"applies_website" boolean DEFAULT false NOT NULL,
	"applies_phone" boolean DEFAULT false NOT NULL,
	"stay_start" date,
	"stay_end" date,
	"no_show_charge_type" varchar(30),
	"no_show_charge_value" bigint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cancellation_policies_source_check" CHECK ("cancellation_policies"."applies_website" or "cancellation_policies"."applies_phone"),
	CONSTRAINT "cancellation_policies_dates_check" CHECK ("cancellation_policies"."stay_start" is null or "cancellation_policies"."stay_end" is null or "cancellation_policies"."stay_end" >= "cancellation_policies"."stay_start"),
	CONSTRAINT "cancellation_policies_no_show_check" CHECK ("cancellation_policies"."no_show_charge_value" >= 0 and ("cancellation_policies"."no_show_charge_type" is null or "cancellation_policies"."no_show_charge_type" in ('percentage', 'first_night', 'full_stay')))
);
--> statement-breakpoint
CREATE TABLE "cancellation_policy_room_types" (
	"policy_id" uuid NOT NULL,
	"room_type_id" uuid NOT NULL,
	CONSTRAINT "cancellation_policy_room_types_policy_id_room_type_id_pk" PRIMARY KEY("policy_id","room_type_id")
);
--> statement-breakpoint
CREATE TABLE "cancellation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"timing_type" varchar(20) NOT NULL,
	"days_before" smallint NOT NULL,
	"charge_type" varchar(20) NOT NULL,
	"charge_value" bigint DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cancellation_rules_values_check" CHECK ("cancellation_rules"."days_before" >= 0 and "cancellation_rules"."charge_value" >= 0 and "cancellation_rules"."timing_type" in ('more_than', 'within') and "cancellation_rules"."charge_type" in ('percentage', 'fixed', 'nights'))
);
--> statement-breakpoint
CREATE TABLE "experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"code" varchar(120) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"price" bigint DEFAULT 0 NOT NULL,
	"max_quantity" smallint DEFAULT 1 NOT NULL,
	"image_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiences_code_unique" UNIQUE("code"),
	CONSTRAINT "experiences_slug_unique" UNIQUE("slug"),
	CONSTRAINT "experiences_price_quantity_check" CHECK ("experiences"."price" >= 0 and "experiences"."max_quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(160) NOT NULL,
	"phone" varchar(40),
	"email" varchar(255),
	"nationality" text,
	"address" text,
	"internal_notes" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guests_status_check" CHECK ("guests"."status" in ('active', 'blacklisted'))
);
--> statement-breakpoint
CREATE TABLE "master_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" varchar(60) NOT NULL,
	"code" varchar(80) NOT NULL,
	"name" varchar(160) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"provider_reference" varchar(160),
	"processed_by_user_id" uuid,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_refunds_amount_status_check" CHECK ("payment_refunds"."amount" > 0 and "payment_refunds"."status" in ('pending', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(80) NOT NULL,
	"event_id" varchar(160) NOT NULL,
	"payment_id" uuid,
	"event_type" varchar(80) NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"method_id" uuid NOT NULL,
	"provider" varchar(80),
	"provider_reference" varchar(160),
	"amount" bigint NOT NULL,
	"status" varchar(20) NOT NULL,
	"paid_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"recorded_by_user_id" uuid,
	"notes" text,
	"idempotency_key" varchar(160),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payments_amount_status_check" CHECK ("payments"."amount" > 0 and "payments"."version" >= 1 and "payments"."status" in ('pending', 'succeeded', 'failed', 'expired', 'refunded', 'partially_refunded'))
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(120) NOT NULL,
	"module" varchar(80) NOT NULL,
	"label" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "reservation_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"reservation_room_id" uuid,
	"kind" varchar(30) NOT NULL,
	"source_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_amount" bigint DEFAULT 0 NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"service_date" date,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_charges_kind_check" CHECK ("reservation_charges"."kind" in ('room', 'extra_bed', 'experience', 'breakfast', 'room_change', 'extension', 'cancellation', 'adjustment')),
	CONSTRAINT "reservation_charges_quantity_check" CHECK ("reservation_charges"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "reservation_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"amount_held" bigint DEFAULT 0 NOT NULL,
	"amount_refunded" bigint DEFAULT 0 NOT NULL,
	"amount_deducted" bigint DEFAULT 0 NOT NULL,
	"method_id" uuid,
	"status" varchar(20) DEFAULT 'held' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_deposits_amount_status_check" CHECK ("reservation_deposits"."amount_held" >= 0 and "reservation_deposits"."amount_refunded" >= 0 and "reservation_deposits"."amount_deducted" >= 0 and "reservation_deposits"."amount_refunded" + "reservation_deposits"."amount_deducted" <= "reservation_deposits"."amount_held" and "reservation_deposits"."status" in ('held', 'partially_refunded', 'refunded', 'deducted'))
);
--> statement-breakpoint
CREATE TABLE "reservation_experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"experience_id" uuid NOT NULL,
	"name_snapshot" varchar(160) NOT NULL,
	"description_snapshot" text,
	"quantity" smallint DEFAULT 1 NOT NULL,
	"unit_price" bigint DEFAULT 0 NOT NULL,
	"service_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_experiences_values_check" CHECK ("reservation_experiences"."quantity" >= 1 and "reservation_experiences"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reservation_room_extra_beds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_room_id" uuid NOT NULL,
	"quantity" smallint DEFAULT 1 NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"unit_price_per_night" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_room_extra_beds_values_check" CHECK ("reservation_room_extra_beds"."quantity" >= 1 and "reservation_room_extra_beds"."date_to" > "reservation_room_extra_beds"."date_from" and "reservation_room_extra_beds"."unit_price_per_night" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reservation_room_nights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_room_id" uuid NOT NULL,
	"stay_date" date NOT NULL,
	"base_price" bigint DEFAULT 0 NOT NULL,
	"discount_amount" bigint DEFAULT 0 NOT NULL,
	"final_price" bigint DEFAULT 0 NOT NULL,
	"campaign_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_room_nights_prices_check" CHECK ("reservation_room_nights"."base_price" >= 0 and "reservation_room_nights"."discount_amount" >= 0 and "reservation_room_nights"."final_price" >= 0 and "reservation_room_nights"."final_price" = "reservation_room_nights"."base_price" - "reservation_room_nights"."discount_amount")
);
--> statement-breakpoint
CREATE TABLE "reservation_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"room_type_id" uuid NOT NULL,
	"room_unit_id" uuid,
	"room_type_name_snapshot" varchar(160) NOT NULL,
	"adults" smallint DEFAULT 0 NOT NULL,
	"children" smallint DEFAULT 0 NOT NULL,
	"bed_configuration_snapshot" varchar(160),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_rooms_guests_check" CHECK ("reservation_rooms"."adults" >= 0 and "reservation_rooms"."children" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reservation_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_in_time" time DEFAULT '14:00' NOT NULL,
	"check_out_time" time DEFAULT '12:00' NOT NULL,
	"auto_confirm_website_after_payment" boolean DEFAULT true NOT NULL,
	"allow_outstanding_check_in" boolean DEFAULT true NOT NULL,
	"allow_outstanding_check_out" boolean DEFAULT true NOT NULL,
	"website_payment_expiry_minutes" smallint DEFAULT 30 NOT NULL,
	"no_show_mode" varchar(20) DEFAULT 'manual' NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_settings_values_check" CHECK ("reservation_settings"."website_payment_expiry_minutes" >= 1 and "reservation_settings"."no_show_mode" = 'manual')
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_code" varchar(40) NOT NULL,
	"guest_id" uuid NOT NULL,
	"source" varchar(20) NOT NULL,
	"ota_channel_id" uuid,
	"external_reference" varchar(120),
	"check_in_date" date NOT NULL,
	"check_out_date" date NOT NULL,
	"adults" smallint DEFAULT 0 NOT NULL,
	"children" smallint DEFAULT 0 NOT NULL,
	"reservation_status" varchar(25) DEFAULT 'pending' NOT NULL,
	"payment_status" varchar(20) DEFAULT 'unpaid' NOT NULL,
	"operational_status" varchar(30),
	"special_requests" text,
	"internal_notes" text,
	"cancellation_policy_id" uuid,
	"cancellation_policy_snapshot" jsonb,
	"promo_code_snapshot" varchar(80),
	"payment_expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"checked_out_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"cancellation_reason" text,
	"checkout_outstanding_reason" text,
	"created_by_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_booking_code_unique" UNIQUE("booking_code"),
	CONSTRAINT "reservations_dates_guests_check" CHECK ("reservations"."check_out_date" > "reservations"."check_in_date" and "reservations"."adults" >= 0 and "reservations"."children" >= 0 and "reservations"."version" >= 1),
	CONSTRAINT "reservations_source_check" CHECK ("reservations"."source" in ('website', 'phone', 'walk_in', 'ota')),
	CONSTRAINT "reservations_ota_channel_check" CHECK ("reservations"."source" <> 'ota' or "reservations"."ota_channel_id" is not null),
	CONSTRAINT "reservations_status_check" CHECK ("reservations"."reservation_status" in ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'expired')),
	CONSTRAINT "reservations_payment_status_check" CHECK ("reservations"."payment_status" in ('unpaid', 'partial', 'paid', 'failed', 'refunded', 'expired')),
	CONSTRAINT "reservations_operational_status_check" CHECK ("reservations"."operational_status" is null or "reservations"."operational_status" in ('awaiting_confirmation', 'upcoming', 'ready_to_check_in', 'checked_in', 'in_house', 'due_out', 'overdue', 'checked_out', 'cancelled', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "room_change_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_room_id" uuid NOT NULL,
	"from_room_type_id" uuid,
	"to_room_type_id" uuid,
	"from_room_unit_id" uuid,
	"to_room_unit_id" uuid,
	"price_difference" bigint DEFAULT 0 NOT NULL,
	"reason" text,
	"changed_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_inventory_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_type_id" uuid NOT NULL,
	"stay_date" date NOT NULL,
	"base_price" bigint DEFAULT 0 NOT NULL,
	"sellable_stock" smallint DEFAULT 0 NOT NULL,
	"min_nights" smallint DEFAULT 1 NOT NULL,
	"stop_sell" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_inventory_daily_values_check" CHECK ("room_inventory_daily"."base_price" >= 0 and "room_inventory_daily"."sellable_stock" >= 0 and "room_inventory_daily"."min_nights" >= 1 and "room_inventory_daily"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "room_type_amenities" (
	"room_type_id" uuid NOT NULL,
	"amenity_id" uuid NOT NULL,
	CONSTRAINT "room_type_amenities_room_type_id_amenity_id_pk" PRIMARY KEY("room_type_id","amenity_id")
);
--> statement-breakpoint
CREATE TABLE "room_type_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_type_id" uuid NOT NULL,
	"url" text NOT NULL,
	"alt_text" varchar(255),
	"is_cover" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(40) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"size_sqm" numeric(6, 2),
	"bed_type_id" uuid,
	"meal_type_id" uuid,
	"view_type_id" uuid,
	"bed_count" smallint DEFAULT 1 NOT NULL,
	"base_adults" smallint DEFAULT 0 NOT NULL,
	"base_children" smallint DEFAULT 0 NOT NULL,
	"max_adults" smallint DEFAULT 0 NOT NULL,
	"max_children" smallint DEFAULT 0 NOT NULL,
	"extra_bed_enabled" boolean DEFAULT false NOT NULL,
	"max_extra_beds" smallint DEFAULT 0 NOT NULL,
	"extra_bed_price_per_night" bigint DEFAULT 0 NOT NULL,
	"adult_breakfast_price" bigint DEFAULT 0 NOT NULL,
	"child_breakfast_price" bigint DEFAULT 0 NOT NULL,
	"base_price_per_night" bigint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_types_code_unique" UNIQUE("code"),
	CONSTRAINT "room_types_slug_unique" UNIQUE("slug"),
	CONSTRAINT "room_types_capacity_check" CHECK ("room_types"."bed_count" >= 1 and "room_types"."base_adults" >= 0 and "room_types"."base_children" >= 0 and "room_types"."max_adults" >= "room_types"."base_adults" and "room_types"."max_children" >= "room_types"."base_children" and "room_types"."max_extra_beds" >= 0),
	CONSTRAINT "room_types_prices_check" CHECK ("room_types"."extra_bed_price_per_night" >= 0 and "room_types"."adult_breakfast_price" >= 0 and "room_types"."child_breakfast_price" >= 0 and "room_types"."base_price_per_night" >= 0)
);
--> statement-breakpoint
CREATE TABLE "room_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_type_id" uuid NOT NULL,
	"room_number" varchar(30) NOT NULL,
	"floor_id" uuid,
	"bed_configuration" varchar(160),
	"operational_status" varchar(30) DEFAULT 'available' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_units_room_number_unique" UNIQUE("room_number"),
	CONSTRAINT "room_units_status_check" CHECK ("room_units"."operational_status" in ('available', 'occupied', 'cleaning', 'maintenance', 'out_of_service'))
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"email" varchar(255) NOT NULL,
	"username" varchar(80),
	"phone" varchar(40),
	"password_hash" text NOT NULL,
	"photo_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_blackout_dates" ADD CONSTRAINT "campaign_blackout_dates_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_days" ADD CONSTRAINT "campaign_days_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_room_types" ADD CONSTRAINT "campaign_room_types_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_room_types" ADD CONSTRAINT "campaign_room_types_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sources" ADD CONSTRAINT "campaign_sources_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_cancellation_policy_id_cancellation_policies_id_fk" FOREIGN KEY ("cancellation_policy_id") REFERENCES "public"."cancellation_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_policies" ADD CONSTRAINT "cancellation_policies_policy_type_id_master_items_id_fk" FOREIGN KEY ("policy_type_id") REFERENCES "public"."master_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_policy_room_types" ADD CONSTRAINT "cancellation_policy_room_types_policy_id_cancellation_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."cancellation_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_policy_room_types" ADD CONSTRAINT "cancellation_policy_room_types_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_rules" ADD CONSTRAINT "cancellation_rules_policy_id_cancellation_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."cancellation_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_category_id_master_items_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."master_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_processed_by_user_id_users_id_fk" FOREIGN KEY ("processed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_id_master_items_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."master_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_charges" ADD CONSTRAINT "reservation_charges_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_charges" ADD CONSTRAINT "reservation_charges_reservation_room_id_reservation_rooms_id_fk" FOREIGN KEY ("reservation_room_id") REFERENCES "public"."reservation_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_charges" ADD CONSTRAINT "reservation_charges_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_deposits" ADD CONSTRAINT "reservation_deposits_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_deposits" ADD CONSTRAINT "reservation_deposits_method_id_master_items_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."master_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_experiences" ADD CONSTRAINT "reservation_experiences_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_experiences" ADD CONSTRAINT "reservation_experiences_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_room_extra_beds" ADD CONSTRAINT "reservation_room_extra_beds_reservation_room_id_reservation_rooms_id_fk" FOREIGN KEY ("reservation_room_id") REFERENCES "public"."reservation_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_room_nights" ADD CONSTRAINT "reservation_room_nights_reservation_room_id_reservation_rooms_id_fk" FOREIGN KEY ("reservation_room_id") REFERENCES "public"."reservation_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_room_nights" ADD CONSTRAINT "reservation_room_nights_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_rooms" ADD CONSTRAINT "reservation_rooms_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_rooms" ADD CONSTRAINT "reservation_rooms_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_rooms" ADD CONSTRAINT "reservation_rooms_room_unit_id_room_units_id_fk" FOREIGN KEY ("room_unit_id") REFERENCES "public"."room_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_settings" ADD CONSTRAINT "reservation_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_ota_channel_id_master_items_id_fk" FOREIGN KEY ("ota_channel_id") REFERENCES "public"."master_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_cancellation_policy_id_cancellation_policies_id_fk" FOREIGN KEY ("cancellation_policy_id") REFERENCES "public"."cancellation_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_change_history" ADD CONSTRAINT "room_change_history_reservation_room_id_reservation_rooms_id_fk" FOREIGN KEY ("reservation_room_id") REFERENCES "public"."reservation_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_change_history" ADD CONSTRAINT "room_change_history_from_room_type_id_room_types_id_fk" FOREIGN KEY ("from_room_type_id") REFERENCES "public"."room_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_change_history" ADD CONSTRAINT "room_change_history_to_room_type_id_room_types_id_fk" FOREIGN KEY ("to_room_type_id") REFERENCES "public"."room_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_change_history" ADD CONSTRAINT "room_change_history_from_room_unit_id_room_units_id_fk" FOREIGN KEY ("from_room_unit_id") REFERENCES "public"."room_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_change_history" ADD CONSTRAINT "room_change_history_to_room_unit_id_room_units_id_fk" FOREIGN KEY ("to_room_unit_id") REFERENCES "public"."room_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_change_history" ADD CONSTRAINT "room_change_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_inventory_daily" ADD CONSTRAINT "room_inventory_daily_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_type_amenities" ADD CONSTRAINT "room_type_amenities_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_type_amenities" ADD CONSTRAINT "room_type_amenities_amenity_id_master_items_id_fk" FOREIGN KEY ("amenity_id") REFERENCES "public"."master_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_type_images" ADD CONSTRAINT "room_type_images_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_types" ADD CONSTRAINT "room_types_bed_type_id_master_items_id_fk" FOREIGN KEY ("bed_type_id") REFERENCES "public"."master_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_types" ADD CONSTRAINT "room_types_meal_type_id_master_items_id_fk" FOREIGN KEY ("meal_type_id") REFERENCES "public"."master_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_types" ADD CONSTRAINT "room_types_view_type_id_master_items_id_fk" FOREIGN KEY ("view_type_id") REFERENCES "public"."master_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_units" ADD CONSTRAINT "room_units_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_units" ADD CONSTRAINT "room_units_floor_id_master_items_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."master_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "master_items_category_code_uq" ON "master_items" USING btree ("category","code");--> statement-breakpoint
CREATE INDEX "master_items_category_idx" ON "master_items" USING btree ("category");--> statement-breakpoint
CREATE INDEX "payment_refunds_payment_idx" ON "payment_refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_provider_event_uq" ON "payment_webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "payments_reservation_idx" ON "payments" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "payments_provider_reference_idx" ON "payments" USING btree ("provider_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_reference_uq" ON "payments" USING btree ("provider","provider_reference") WHERE "payments"."provider_reference" is not null;--> statement-breakpoint
CREATE INDEX "reservation_charges_reservation_idx" ON "reservation_charges" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "reservation_deposits_reservation_idx" ON "reservation_deposits" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "reservation_experiences_reservation_idx" ON "reservation_experiences" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_room_nights_room_date_uq" ON "reservation_room_nights" USING btree ("reservation_room_id","stay_date");--> statement-breakpoint
CREATE INDEX "reservation_rooms_reservation_idx" ON "reservation_rooms" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "reservation_rooms_unit_reservation_idx" ON "reservation_rooms" USING btree ("room_unit_id","reservation_id");--> statement-breakpoint
CREATE INDEX "reservations_check_in_status_idx" ON "reservations" USING btree ("check_in_date","reservation_status");--> statement-breakpoint
CREATE INDEX "reservations_check_out_status_idx" ON "reservations" USING btree ("check_out_date","reservation_status");--> statement-breakpoint
CREATE INDEX "reservations_operational_payment_idx" ON "reservations" USING btree ("operational_status","payment_status");--> statement-breakpoint
CREATE INDEX "reservations_guest_created_idx" ON "reservations" USING btree ("guest_id","created_at");--> statement-breakpoint
CREATE INDEX "reservations_source_created_idx" ON "reservations" USING btree ("source","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_ota_reference_uq" ON "reservations" USING btree ("ota_channel_id","external_reference") WHERE "reservations"."external_reference" is not null;--> statement-breakpoint
CREATE INDEX "room_change_history_reservation_room_idx" ON "room_change_history" USING btree ("reservation_room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_inventory_daily_type_date_uq" ON "room_inventory_daily" USING btree ("room_type_id","stay_date");--> statement-breakpoint
CREATE INDEX "room_inventory_daily_stay_date_idx" ON "room_inventory_daily" USING btree ("stay_date");--> statement-breakpoint
CREATE UNIQUE INDEX "room_type_images_one_cover_uq" ON "room_type_images" USING btree ("room_type_id") WHERE "room_type_images"."is_cover" = true;--> statement-breakpoint
CREATE INDEX "room_units_type_status_idx" ON "room_units" USING btree ("room_type_id","operational_status");--> statement-breakpoint
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions" USING btree ("user_id");