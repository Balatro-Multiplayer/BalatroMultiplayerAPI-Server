-- A report page that opens once from the game, and a report the player withdrew.
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "page_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "withdrawn_at" timestamp with time zone;
