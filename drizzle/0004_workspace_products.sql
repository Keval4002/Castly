CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"category" text NOT NULL,
	"product_type" text,
	"source_asset_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "look" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "shop_name" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "sells" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "default_purpose" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_source_asset_id_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_user_idx" ON "products" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_source_asset_idx" ON "products" USING btree ("source_asset_id");--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generations_product_idx" ON "generations" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Existing users skip onboarding; every existing upload becomes a catalogue product.
UPDATE "profiles" SET "onboarded_at" = now() WHERE "onboarded_at" IS NULL;--> statement-breakpoint
INSERT INTO "products" ("user_id", "name", "category", "product_type", "source_asset_id", "created_at")
SELECT a."user_id",
       coalesce(nullif(a."classification"->>'description', ''), 'Product'),
       CASE WHEN a."classification"->>'category' IN ('clothing','jewellery') THEN a."classification"->>'category' ELSE 'clothing' END,
       a."classification"->>'productType',
       a."id",
       a."created_at"
FROM "assets" a WHERE a."kind" = 'upload'
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "generations" g SET "product_id" = p."id" FROM "products" p WHERE p."source_asset_id" = g."source_asset_id" AND g."product_id" IS NULL;
