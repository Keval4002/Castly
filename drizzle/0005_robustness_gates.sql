ALTER TYPE "public"."image_status" ADD VALUE 'held';--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_images" ADD COLUMN "next_check_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_images" ADD COLUMN "check_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE INDEX "generation_images_held_idx" ON "generation_images" USING btree ("status","next_check_at");--> statement-breakpoint
CREATE UNIQUE INDEX "generations_idem_idx" ON "generations" USING btree ("user_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;