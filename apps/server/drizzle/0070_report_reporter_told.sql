-- Marks a report whose reporter was told that staff acted on the reported player.
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "reporter_told_at" timestamp with time zone;
