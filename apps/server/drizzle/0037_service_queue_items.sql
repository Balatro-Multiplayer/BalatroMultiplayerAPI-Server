-- Single lightweight pointer/index table backing the unified admin Service
-- Queue page (player reports, flagged chat, match result conflicts, forfeit
-- reconciliation flags, anti-cheat signals). One row per source item,
-- inserted by service-queue.gateway.ts's enqueueServiceQueueItem at the same
-- site each source item is created -- the list page reads only this table,
-- never joining the 5 source tables. See schema.ts's serviceQueueItems
-- comment for the status/subjectPlayerId design rationale.
CREATE TABLE IF NOT EXISTS "service_queue_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"item_type" varchar(32) NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"subject_player_id" text,
	"status" varchar(16) NOT NULL DEFAULT 'open',
	"priority" integer,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution_action" varchar(32)
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_queue_items_type_source_idx"
	ON "service_queue_items" ("item_type", "source_id");

CREATE INDEX IF NOT EXISTS "service_queue_items_status_type_created_idx"
	ON "service_queue_items" ("status", "item_type", "created_at");

CREATE INDEX IF NOT EXISTS "service_queue_items_subject_player_idx"
	ON "service_queue_items" ("subject_player_id")
	WHERE "subject_player_id" IS NOT NULL;
