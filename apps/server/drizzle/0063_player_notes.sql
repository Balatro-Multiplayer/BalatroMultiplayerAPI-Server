-- Staff notes on a player, written from the staff player page.
CREATE TABLE IF NOT EXISTS "player_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL REFERENCES "players"("id"),
	"author_id" uuid NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_notes_player_idx" ON "player_notes" ("player_id", "created_at");
