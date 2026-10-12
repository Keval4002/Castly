-- All data access goes through the Next.js server using a direct Postgres
-- connection. Enable RLS with no policies so Supabase's public Data API
-- (anon / authenticated keys) can never read or write these tables.
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credit_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "generations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "generation_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
