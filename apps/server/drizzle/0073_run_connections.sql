-- Each finished run's joins, leaves and rejoins per player, and the log counts the server held.
ALTER TABLE "lobby_runs" ADD COLUMN IF NOT EXISTS "connections" jsonb;
