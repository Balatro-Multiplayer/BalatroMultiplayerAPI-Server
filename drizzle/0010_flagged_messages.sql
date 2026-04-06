CREATE TABLE "flagged_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"player_id" text NOT NULL,
	"message" text NOT NULL,
	"matches" jsonb NOT NULL,
	"flagged_at" timestamp with time zone NOT NULL DEFAULT now(),
	"expires_at" timestamp with time zone NOT NULL
);

CREATE INDEX "flagged_messages_expires_at_idx" ON "flagged_messages" ("expires_at");
