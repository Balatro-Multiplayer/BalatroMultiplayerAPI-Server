-- Persisted mirror of grace-period.service.ts's in-memory `gracePeriods` Map
-- -- a disconnected player's 2-minute countdown before auto-forfeit, durable
-- across a bmp-api restart (previously: pure in-memory, silently dropped on
-- shutdown). No FK on player_id, same precedent as forfeit_reconciliation_flags.
CREATE TABLE IF NOT EXISTS "grace_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"lobby_code" varchar(6) NOT NULL,
	"display_name" text NOT NULL,
	"disconnected_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);
