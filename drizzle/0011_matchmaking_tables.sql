CREATE TABLE "matchmaking_matches" (
	"match_id" varchar(36) PRIMARY KEY NOT NULL,
	"lobby_code" varchar(5) NOT NULL,
	"mod_id" varchar(128) NOT NULL,
	"game_mode" varchar(128) NOT NULL,
	"players" jsonb NOT NULL,
	"lobby_state" jsonb NOT NULL,
	"status" varchar(32) NOT NULL DEFAULT 'active',
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "matchmaking_matches_lobby_code_unique" UNIQUE("lobby_code")
);

CREATE TABLE "matchmaking_ratings" (
	"player_id" uuid NOT NULL,
	"mod_id" varchar(128) NOT NULL,
	"game_mode" varchar(128) NOT NULL,
	"season" integer NOT NULL,
	"rating" integer NOT NULL DEFAULT 600,
	"wins" integer NOT NULL DEFAULT 0,
	"losses" integer NOT NULL DEFAULT 0,
	"games_played" integer NOT NULL DEFAULT 0,
	"last_match_at" timestamp with time zone,
	"decay_applied_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "matchmaking_ratings_player_id_mod_id_game_mode_season_pk" PRIMARY KEY("player_id","mod_id","game_mode","season")
);

CREATE TABLE "leaderboard_cache" (
	"mod_id" varchar(128) NOT NULL,
	"game_mode" varchar(128) NOT NULL,
	"season" integer NOT NULL,
	"rank" integer NOT NULL,
	"player_id" uuid NOT NULL,
	"display_name" varchar(64) NOT NULL,
	"rating" integer NOT NULL,
	"wins" integer NOT NULL,
	"losses" integer NOT NULL,
	"games_played" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "leaderboard_cache_mod_id_game_mode_season_rank_pk" PRIMARY KEY("mod_id","game_mode","season","rank")
);

CREATE TABLE "seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);

DO $$ BEGIN
	ALTER TABLE "matchmaking_ratings" ADD CONSTRAINT "matchmaking_ratings_player_id_players_id_fk"
		FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

CREATE INDEX "mmr_rating_idx" ON "matchmaking_ratings" ("mod_id","game_mode","season","rating");
CREATE INDEX "lb_player_idx" ON "leaderboard_cache" ("mod_id","game_mode","season","player_id");

-- Seed initial season
INSERT INTO "seasons" ("name", "started_at", "ends_at")
VALUES ('Season 1', NOW(), NOW() + INTERVAL '90 days')
ON CONFLICT DO NOTHING;
