-- A candidate "wrongful auto-forfeit" flag: a player reconnected shortly
-- after a match involving them resolved via the grace-period auto-forfeit
-- path (see grace-period.service.ts's checkForWrongfulForfeit). Purely a
-- moderator-review flag -- never itself a trigger for a rating change.
CREATE TABLE IF NOT EXISTS "forfeit_reconciliation_flags" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"match_id" varchar(36) NOT NULL,
	"lobby_code" varchar(6) NOT NULL,
	"player_id" uuid NOT NULL,
	"forfeited_at" timestamp with time zone NOT NULL,
	"reconnected_at" timestamp with time zone NOT NULL,
	"status" varchar(16) NOT NULL DEFAULT 'open',
	"resolution_notes" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);
