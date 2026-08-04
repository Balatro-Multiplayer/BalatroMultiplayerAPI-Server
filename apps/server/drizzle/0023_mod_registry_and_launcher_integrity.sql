-- Adds the mod catalog (mod_registry/mod_registry_versions, synced from
-- BETModIndex + admin overrides), admin-authored ranked mod profiles
-- (mod_profiles/mod_profile_entries, info-only for now), and the audit trail
-- for the launcher-integrity challenge/response system
-- (launcher_integrity_events -- the challenges themselves are in-memory only,
-- see state/launcher-integrity.ts; this table only records a failure/refusal
-- for moderator review, mirroring match_run_logs.flagReason).
CREATE TABLE IF NOT EXISTS "mod_registry" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"title" varchar(128) NOT NULL,
	"author" varchar(128) NOT NULL,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"requires_steamodded" boolean DEFAULT true NOT NULL,
	"requires_talisman" boolean DEFAULT false NOT NULL,
	"repo_url" text,
	"thumbnail_url" text,
	"description" text,
	"latest_version" varchar(64),
	"latest_download_url" text,
	"latest_sha256" varchar(64),
	"allowed_in_ranked" boolean DEFAULT false NOT NULL,
	"allowed_in_ranked_source" varchar(16) DEFAULT 'index' NOT NULL,
	"source_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "mod_registry_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"mod_id" varchar(128) NOT NULL REFERENCES "mod_registry"("id") ON DELETE CASCADE,
	"version" varchar(64) NOT NULL,
	"sha256" varchar(64),
	"download_url" text,
	"released_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "mod_registry_versions_mod_version_idx" ON "mod_registry_versions" ("mod_id", "version");

CREATE TABLE IF NOT EXISTS "mod_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(128) NOT NULL,
	"slug" varchar(128) NOT NULL UNIQUE,
	"description" text,
	"created_by" uuid REFERENCES "players"("id"),
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "mod_profile_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"profile_id" uuid NOT NULL REFERENCES "mod_profiles"("id") ON DELETE CASCADE,
	"mod_id" varchar(128) NOT NULL REFERENCES "mod_registry"("id") ON DELETE CASCADE,
	"version_constraint" varchar(64) DEFAULT 'any' NOT NULL,
	"allowed" boolean DEFAULT true NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "mod_profile_entries_profile_mod_idx" ON "mod_profile_entries" ("profile_id", "mod_id");

CREATE TABLE IF NOT EXISTS "launcher_integrity_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"player_id" uuid NOT NULL REFERENCES "players"("id"),
	"kind" varchar(16) NOT NULL,
	"reason" varchar(16) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "launcher_integrity_events_player_idx" ON "launcher_integrity_events" ("player_id");
