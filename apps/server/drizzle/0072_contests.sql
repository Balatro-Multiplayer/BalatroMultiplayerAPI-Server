-- Contests of a match: made in the game, or (later) from the website. One per player per match.
CREATE TABLE IF NOT EXISTS "contests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
	"run_id" varchar(36) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"contester_id" uuid NOT NULL REFERENCES "players"("id"),
	"against_id" uuid REFERENCES "players"("id"),
	"reason" varchar(16),
	"detail" text,
	"page_opened_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contests_run_contester_idx" ON "contests" ("run_id", "contester_id");
