ALTER TYPE "public"."image_status" ADD VALUE 'running' BEFORE 'succeeded';--> statement-breakpoint
CREATE TABLE "product_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"angle" text DEFAULT 'front' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"generation_id" uuid,
	"image_id" uuid,
	"stage" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	"latency_ms" integer,
	"est_cost_micros" integer DEFAULT 0 NOT NULL,
	"actual_cost_micros" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_images" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_images" ADD COLUMN "dispatch_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_images" ADD COLUMN "seed" integer;--> statement-breakpoint
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_photos_asset_idx" ON "product_photos" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "product_photos_product_idx" ON "product_photos" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "provider_calls_gen_idx" ON "provider_calls" USING btree ("generation_id");--> statement-breakpoint
CREATE INDEX "provider_calls_created_idx" ON "provider_calls" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "provider_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Every existing product's main photo becomes its "front" photo.
INSERT INTO "product_photos" ("product_id", "asset_id", "angle", "created_at")
SELECT "id", "source_asset_id", 'front', "created_at" FROM "products"
ON CONFLICT DO NOTHING;
