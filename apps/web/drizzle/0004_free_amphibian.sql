CREATE TABLE "log_file_owner_connections" (
	"log_file_id" integer NOT NULL,
	"connection_id" text NOT NULL,
	"connection_id_lower" text NOT NULL,
	CONSTRAINT "log_file_owner_connections_log_file_id_connection_id_lower_pk" PRIMARY KEY("log_file_id","connection_id_lower")
);
--> statement-breakpoint
ALTER TABLE "log_file_owner_connections" ADD CONSTRAINT "log_file_owner_connections_log_file_id_log_files_id_fk" FOREIGN KEY ("log_file_id") REFERENCES "public"."log_files"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "log_file_owner_connections" ("log_file_id", "connection_id", "connection_id_lower")
SELECT
	"log_files"."id",
	substring("mod_entry"."value" from '(?i)^serversideConnectionID=(.+)$'),
	lower(substring("mod_entry"."value" from '(?i)^serversideConnectionID=(.+)$'))
FROM "log_files"
CROSS JOIN LATERAL json_array_elements(
	CASE
		WHEN json_typeof("log_files"."parsed_json") = 'array' THEN "log_files"."parsed_json"
		ELSE '[]'::json
	END
) AS "game"
CROSS JOIN LATERAL json_array_elements_text(
	CASE
		WHEN ("game"->>'isHost') = 'true' THEN COALESCE("game"->'hostMods', '[]'::json)
		WHEN ("game"->>'isHost') = 'false' THEN COALESCE("game"->'guestMods', '[]'::json)
		WHEN COALESCE("game"->>'logOwnerName', '') <> '' AND ("game"->>'logOwnerName') = ("game"->>'host') THEN COALESCE("game"->'hostMods', '[]'::json)
		WHEN COALESCE("game"->>'logOwnerName', '') <> '' AND ("game"->>'logOwnerName') = ("game"->>'guest') THEN COALESCE("game"->'guestMods', '[]'::json)
		ELSE '[]'::json
	END
) AS "mod_entry"("value")
WHERE "mod_entry"."value" ~* '^serversideConnectionID='
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE INDEX "log_file_owner_connections_connection_id_lower_trgm_idx"
	ON "log_file_owner_connections"
	USING gin ("connection_id_lower" gin_trgm_ops);
