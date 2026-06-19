CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "log_file_players" (
	"log_file_id" integer NOT NULL,
	"player_name" text NOT NULL,
	"player_name_lower" text NOT NULL,
	CONSTRAINT "log_file_players_log_file_id_player_name_lower_pk" PRIMARY KEY("log_file_id","player_name_lower")
);
--> statement-breakpoint
ALTER TABLE "log_file_players" ADD CONSTRAINT "log_file_players_log_file_id_log_files_id_fk" FOREIGN KEY ("log_file_id") REFERENCES "public"."log_files"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "log_file_players" ("log_file_id", "player_name", "player_name_lower")
SELECT DISTINCT
	"log_files"."id",
	"players"."player_name",
	lower("players"."player_name")
FROM "log_files"
CROSS JOIN LATERAL json_array_elements(
	CASE
		WHEN json_typeof("log_files"."parsed_json") = 'array' THEN "log_files"."parsed_json"
		ELSE '[]'::json
	END
) AS "game"
CROSS JOIN LATERAL (
	VALUES
		(nullif(btrim("game"->>'host'), '')),
		(nullif(btrim("game"->>'guest'), ''))
) AS "players"("player_name")
WHERE "players"."player_name" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE INDEX "log_file_players_player_name_lower_trgm_idx"
	ON "log_file_players"
	USING gin ("player_name_lower" gin_trgm_ops);
