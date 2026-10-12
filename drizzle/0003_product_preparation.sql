ALTER TABLE "assets" ADD COLUMN "clean_key" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "clean_thumb_key" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "preparation" jsonb;--> statement-breakpoint
ALTER TABLE "generation_images" ADD COLUMN "fidelity" jsonb;--> statement-breakpoint
ALTER TABLE "generation_images" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;