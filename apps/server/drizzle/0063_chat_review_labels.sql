-- Training labels for flagged chat: one for each flagged message of each
-- decided flagged chat item.
CREATE TABLE IF NOT EXISTS "chat_review_labels" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"item_id" integer NOT NULL,
	"flagged_message_id" integer NOT NULL,
	"message" text NOT NULL,
	"context" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score" double precision,
	"band" varchar(64),
	"label" varchar(32) NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_review_labels_item_message_idx" ON "chat_review_labels" ("item_id", "flagged_message_id");
