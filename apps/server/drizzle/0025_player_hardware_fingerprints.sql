-- Adds player_hardware_fingerprints: one row per (player, hardware component)
-- the launcher has attested to. Submitted only alongside a launcher-integrity
-- LOGIN challenge (never periodic), and only once that challenge's signature
-- has already verified -- see launcher-integrity.service.ts's
-- handleChallengeResponse. Each component_hash is an HMAC-SHA256 the launcher
-- computed locally (hardwarefingerprint.cpp); the raw hardware identifier
-- never leaves the player's machine. Storage only for now -- no cross-player
-- fuzzy-match/ban-evasion query is built on top of this yet, but
-- (component_name, component_hash) is indexed so that join is cheap to add
-- later ("N of M components match a previously-banned player").
CREATE TABLE IF NOT EXISTS "player_hardware_fingerprints" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"player_id" uuid NOT NULL REFERENCES "players"("id"),
	"platform" varchar(16) NOT NULL,
	"component_name" varchar(32) NOT NULL,
	"component_hash" varchar(64) NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
	"last_seen_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "player_hardware_fingerprints_player_component_idx" ON "player_hardware_fingerprints" ("player_id", "component_name");
CREATE INDEX IF NOT EXISTS "player_hardware_fingerprints_component_idx" ON "player_hardware_fingerprints" ("component_name", "component_hash");
