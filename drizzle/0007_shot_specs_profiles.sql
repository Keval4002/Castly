ALTER TABLE "assets" ADD COLUMN "cutout_key" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "profile" jsonb;--> statement-breakpoint
ALTER TABLE "generation_images" ADD COLUMN "spec" jsonb;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "plan" jsonb;