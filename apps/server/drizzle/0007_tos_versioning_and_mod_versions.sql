-- Add server-side ToS version tracking to players
ALTER TABLE "players" ADD COLUMN "tos_accepted_version" integer NOT NULL DEFAULT 0;
--> statement-breakpoint

-- Singleton config row (id always = 1)
CREATE TABLE "server_config" (
	"id" integer PRIMARY KEY DEFAULT 1,
	"tos_version" integer NOT NULL DEFAULT 1,
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Official mod version registry
CREATE TABLE "mod_versions" (
	"mod_id" varchar(64) PRIMARY KEY,
	"display_name" varchar(64) NOT NULL,
	"version" varchar(32) NOT NULL DEFAULT '0.0.0',
	"download_url" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Seed the singleton config row
INSERT INTO "server_config" ("id", "tos_version") VALUES (1, 1)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

-- Seed the three official mods
INSERT INTO "mod_versions" ("mod_id", "display_name", "version", "download_url") VALUES
	('MultiplayerPvP',          'PvP',     '0.0.0', 'https://github.com/V-rtualized/MultiplayerPvP'),
	('MultiplayerSpeedrunning', 'Speedrun', '0.0.0', 'https://github.com/V-rtualized/MultiplayerSpeedrunning'),
	('MultiplayerCoop',        'Co-op',   '0.0.0', 'https://github.com/V-rtualized/MultiplayerCoop')
ON CONFLICT ("mod_id") DO NOTHING;
