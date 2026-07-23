-- Creates the reports + reported_lobby_messages tables. These were already
-- defined in schema.ts and used throughout the codebase (submission endpoint,
-- webadmin listing, tests) but had never actually been given a migration --
-- this closes that gap, and includes the full final shape (run_id/status/
-- additional_detail) rather than creating the original shape only to alter it
-- again immediately after, since nothing has ever depended on an intermediate
-- state.
CREATE TABLE IF NOT EXISTS "reports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"lobby_id" uuid NOT NULL,
	"lobby_code" varchar(6) NOT NULL,
	"reporter_id" text NOT NULL,
	"reported_id" text NOT NULL,
	"type" varchar(64) NOT NULL,
	"run_id" uuid,
	"status" varchar(16) NOT NULL DEFAULT 'open',
	"message" text,
	"additional_detail" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "reported_lobby_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"lobby_id" uuid NOT NULL,
	"lobby_code" varchar(6) NOT NULL,
	"player_id" text NOT NULL,
	"display_name" varchar(64) NOT NULL,
	"message" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
