-- Lobby codes are 6 characters (generateLobbyCode default), not 5.
-- Widen lobby_code columns across all tables that store them.
ALTER TABLE "game_results" ALTER COLUMN "lobby_code" TYPE varchar(6);
--> statement-breakpoint
ALTER TABLE "chat_logs"    ALTER COLUMN "lobby_code" TYPE varchar(6);
--> statement-breakpoint
ALTER TABLE "action_logs"  ALTER COLUMN "lobby_code" TYPE varchar(6);
