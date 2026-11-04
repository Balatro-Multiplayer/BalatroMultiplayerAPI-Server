-- The staff log: every punishment, lift, queue action and role change, with
-- who did it, to whom and the reason. Earlier queue actions are copied in.
CREATE TABLE IF NOT EXISTS "staff_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"staff_player_id" uuid NOT NULL,
	"staff_role" varchar(16) NOT NULL,
	"action" varchar(32) NOT NULL,
	"target_player_id" uuid,
	"item_id" integer,
	"reason" text NOT NULL,
	"detail" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_log_at_idx" ON "staff_log" ("at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_log_staff_idx" ON "staff_log" ("staff_player_id", "at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_log_target_idx" ON "staff_log" ("target_player_id", "at");--> statement-breakpoint
INSERT INTO "staff_log" ("staff_player_id", "staff_role", "action", "target_player_id", "item_id", "reason", "detail", "at")
SELECT
	split_part(e."actor", ':', 2)::uuid,
	split_part(e."actor", ':', 1),
	CASE e."action" WHEN 'chat_mute' THEN 'chat_ban' WHEN 'unban' THEN 'lift_ban' ELSE e."action" END,
	CASE
		WHEN e."detail" #>> '{target,playerId}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
			THEN (e."detail" #>> '{target,playerId}')::uuid
		WHEN e."detail" ->> 'playerId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
			THEN (e."detail" ->> 'playerId')::uuid
		WHEN i."subject_player_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
			THEN i."subject_player_id"::uuid
		ELSE NULL
	END,
	e."item_id",
	COALESCE(e."note", ''),
	e."detail",
	e."at"
FROM "service_queue_item_events" e
LEFT JOIN "service_queue_items" i ON i."id" = e."item_id"
WHERE e."kind" = 'acted'
	AND e."action" IN ('dismiss', 'resolve', 'warn', 'chat_mute', 'queue_ban', 'account_ban', 'void', 'overturn', 'unban')
	AND e."actor" ~* '^(moderator|admin):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
