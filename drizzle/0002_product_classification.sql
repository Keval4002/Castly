ALTER TABLE "assets" ADD COLUMN "classification" jsonb;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "product_type" text;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "corrections" jsonb DEFAULT '[]'::jsonb NOT NULL;