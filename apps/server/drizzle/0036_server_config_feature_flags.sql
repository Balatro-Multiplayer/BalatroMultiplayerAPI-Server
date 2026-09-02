-- Runtime-toggleable server-wide feature flags, extending the server_config
-- singleton (see schema.ts) with the same typed-column pattern as tos_version.
-- chat_enabled/ranked_enabled replace the old env-var-only AppConfig fields
-- (CHAT_ENABLED/RANKED_ENABLED in env.ts, now removed) -- DB is the sole
-- source of truth from this migration forward. casual_queue_enabled and
-- lobby_creation_enabled are net new: casual_queue_enabled is ranked_enabled's
-- sibling, gating only the non-ranked path of POST /queue; lobby_creation_enabled
-- gates only manual POST /lobbies creation, not matches auto-created by the
-- queue system (already covered by the two queue flags above).
--
-- NOTE: the DEFAULTs below MUST match whatever CHAT_ENABLED/RANKED_ENABLED
-- were set to in production env vars at the moment this migration runs --
-- they become the live production value the instant this runs, since the
-- server_config row (id=1) already exists via loadConfigFromDb()'s seed
-- insert. Confirm before deploying; these defaults mirror env.ts's own
-- prior fallback defaults (CHAT_ENABLED=false, RANKED_ENABLED=true), which
-- may not match whatever prod's actual env vars currently override them to.
ALTER TABLE "server_config" ADD COLUMN "chat_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "server_config" ADD COLUMN "ranked_enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "server_config" ADD COLUMN "casual_queue_enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "server_config" ADD COLUMN "lobby_creation_enabled" boolean DEFAULT true NOT NULL;
