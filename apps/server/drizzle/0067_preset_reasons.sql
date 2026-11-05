-- Preset reasons per queue item type, with the first set.
CREATE TABLE IF NOT EXISTS "preset_reasons" (
	"item_type" varchar(32) PRIMARY KEY NOT NULL,
	"reasons" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
INSERT INTO "preset_reasons" ("item_type", "reasons") VALUES
	('report', '["Evidence confirms the report.","Evidence does not show a rule break.","Not enough evidence to act.","Repeat offence, see the strike ladder.","Report was made in bad faith."]'::jsonb),
	('flagged_chat', '["Slur used against another player.","Threat of harm. Chat ban, not a warning.","Trash talk, but inside the rules.","Spam. Same line sent many times.","Line is on the chat allowlist, no action.","Repeat offence, see the strike ladder."]'::jsonb),
	('match_conflict', '["The log of the match supports this result.","The two reports agree after review.","The log does not support either report.","The result stands as first reported."]'::jsonb),
	('forfeit_reconciliation', '["The player left on purpose.","Disconnect was not the player''s fault.","The log shows the player was still playing.","Forfeit stands."]'::jsonb),
	('contest', '["The log of the match supports the contest.","The log does not support the contest.","The result stands.","The result is changed after review."]'::jsonb),
	('anti_cheat', '["The check failed on a clear signal. Confirmed.","False positive. The player ran a valid setup.","Not enough data to decide. Watch the player.","Repeat flag, see the strike ladder."]'::jsonb),
	('integrity', '["The client files do not match the release.","The mismatch comes from a known mod or update.","Not enough data to decide.","Cleared after review."]'::jsonb),
	('appeal', '["The punishment fits the ladder step. Appeal denied.","First offence and the player showed remorse. Shortened.","The evidence was wrong. Punishment lifted.","No new information in the appeal."]'::jsonb)
ON CONFLICT ("item_type") DO NOTHING;
