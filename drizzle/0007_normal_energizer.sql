CREATE TABLE "log_file_lobby_codes" (
	"log_file_id" integer NOT NULL,
	"lobby_code" text NOT NULL,
	"lobby_code_lower" text NOT NULL,
	CONSTRAINT "log_file_lobby_codes_log_file_id_lobby_code_lower_pk" PRIMARY KEY("log_file_id","lobby_code_lower")
);
--> statement-breakpoint
ALTER TABLE "log_file_lobby_codes" ADD CONSTRAINT "log_file_lobby_codes_log_file_id_log_files_id_fk" FOREIGN KEY ("log_file_id") REFERENCES "public"."log_files"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "log_file_lobby_codes" ("log_file_id", "lobby_code", "lobby_code_lower")
SELECT
	"log_files"."id",
	"lobby_code_entry"."value",
	lower("lobby_code_entry"."value")
FROM "log_files"
CROSS JOIN LATERAL json_array_elements(
	CASE
		WHEN json_typeof("log_files"."parsed_json") = 'array' THEN "log_files"."parsed_json"
		ELSE '[]'::json
	END
) AS "game"
CROSS JOIN LATERAL (
	VALUES (nullif(btrim("game"->>'lobbyCode'), ''))
) AS "lobby_code_entry"("value")
WHERE "lobby_code_entry"."value" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE INDEX "log_file_lobby_codes_lobby_code_lower_trgm_idx"
	ON "log_file_lobby_codes"
	USING gin ("lobby_code_lower" gin_trgm_ops);
