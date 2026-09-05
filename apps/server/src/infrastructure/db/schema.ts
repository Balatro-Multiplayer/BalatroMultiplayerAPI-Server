import { sql } from 'drizzle-orm'
import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	serial,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core'

export const players = pgTable(
	'players',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		steamIdHash: text('steam_id_hash'),
		discordIdHash: text('discord_id_hash'),
		discordUsername: varchar('discord_username', { length: 64 }),
		useDiscordName: boolean('use_discord_name').notNull().default(false),
		preferredJoker: varchar('preferred_joker', { length: 64 })
			.notNull()
			.default('j_joker'),
		privileges: text('privileges').array().notNull().default(sql`'{}'::text[]`),
		steamName: varchar('steam_name', { length: 64 }).notNull(),
		chatEnabled: boolean('chat_enabled').notNull().default(false),
		chatBlocked: boolean('chat_blocked').notNull().default(false),
		tosAcceptedVersion: integer('tos_accepted_version').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
		// Set when the player deletes their account. The row is never hard-deleted:
		// PII fields are cleared immediately (see softDeletePlayer), but steamIdHash
		// survives so an active ban stays enforceable and re-signing in with the same
		// Steam identity reactivates this same row instead of creating a fresh one.
		// Null = active account.
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
	},
	(table) => [
		uniqueIndex('players_steam_id_hash_idx')
			.on(table.steamIdHash)
			.where(sql`steam_id_hash IS NOT NULL`),
		uniqueIndex('players_discord_id_hash_idx')
			.on(table.discordIdHash)
			.where(sql`discord_id_hash IS NOT NULL`),
	],
)

export const refreshTokens = pgTable(
	'refresh_tokens',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		playerId: uuid('player_id')
			.notNull()
			.references(() => players.id, { onDelete: 'cascade' }),
		tokenHash: text('token_hash').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [uniqueIndex('refresh_tokens_hash_idx').on(table.tokenHash)],
)

export const gameResults = pgTable('game_results', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	lobbyCode: varchar('lobby_code', { length: 6 }).notNull(),
	modId: varchar('mod_id', { length: 128 }).notNull(),
	players: jsonb('players').notNull(),
	result: jsonb('result').notNull(),
	startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
	endedAt: timestamp('ended_at', { withTimezone: true }).notNull().defaultNow(),
})

export const chatLogs = pgTable('chat_logs', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	lobbyCode: varchar('lobby_code', { length: 6 }).notNull(),
	// UUID of the sender at send time; pseudonymized to deleted_user_{hash} on account deletion
	playerId: text('player_id').notNull(),
	// Hashed Steam ID (steam_id_hash) — survives account deletion for moderation purposes
	moderationId: text('moderation_id'),
	message: text('message').notNull(),
	flagged: boolean('flagged').notNull().default(false),
	// NULL for flagged/reported messages; set to sentAt + 30 days otherwise
	expiresAt: timestamp('expires_at', { withTimezone: true }),
	moderationVerdict: jsonb('moderation_verdict'),
	sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
})

export const actionLogs = pgTable('action_logs', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	lobbyCode: varchar('lobby_code', { length: 6 }).notNull(),
	playerId: text('player_id').notNull(),
	actionType: varchar('action_type', { length: 128 }).notNull(),
	payload: jsonb('payload').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
})

// Singleton row (id = 1) holding server-wide config values.
// NOTE: the active season is NOT stored here — it is derived from the seasons
// table (the row with ended_at IS NULL). See getCurrentSeason().
export const serverConfig = pgTable('server_config', {
	id: integer('id').primaryKey().default(1),
	tosVersion: integer('tos_version').notNull().default(1),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
})

// One row per official mod — version string and download URL.
export const modVersions = pgTable('mod_versions', {
	modId: varchar('mod_id', { length: 64 }).primaryKey(),
	displayName: varchar('display_name', { length: 64 }).notNull(),
	version: varchar('version', { length: 32 }).notNull().default('0.0.0'),
	downloadUrl: text('download_url').notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
})

export const flaggedMessages = pgTable('flagged_messages', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	playerId: text('player_id').notNull(),
	message: text('message').notNull(),
	matches: jsonb('matches').notNull(),
	flaggedAt: timestamp('flagged_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const reports = pgTable('reports', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	// Unique per lobby instance — same code can be reused across different lobbies
	lobbyId: uuid('lobby_id').notNull(),
	lobbyCode: varchar('lobby_code', { length: 6 }).notNull(),
	reporterId: text('reporter_id').notNull(),
	reportedId: text('reported_id').notNull(),
	// Fixed taxonomy (see ReportType/REPORT_TYPES in report.gateway.ts), validated
	// app-level only -- no DB CHECK constraint, matching playerBans.banType's
	// precedent.
	type: varchar('type', { length: 64 }).notNull(),
	// The most recent lobbyRuns row for this report's lobbyCode at submission
	// time (resolved in report.gateway.ts's submitReport()) -- nullable, since a
	// report filed before any match started on this lobby has nothing to link.
	// This is the actual "match" identifier §15.6 needs for replay/log linking;
	// lobbyId above is a distinct, ephemeral, in-memory lobby-instance id.
	runId: uuid('run_id'),
	// 'open' | 'resolved' -- moderator-settable via PATCH .../resolve. One-way.
	status: varchar('status', { length: 16 }).notNull().default('open'),
	message: text('message'),
	// Submitter-added detail from their scoped /reports/:id status page (§15.5),
	// kept distinct from `message` (the in-game submission-time note).
	additionalDetail: text('additional_detail'),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
})

// Chat messages saved when a lobby receives a report.
// Contains the buffered history at report time plus all subsequent messages.
export const reportedLobbyMessages = pgTable('reported_lobby_messages', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	lobbyId: uuid('lobby_id').notNull(),
	lobbyCode: varchar('lobby_code', { length: 6 }).notNull(),
	playerId: text('player_id').notNull(),
	displayName: varchar('display_name', { length: 64 }).notNull(),
	message: text('message').notNull(),
	sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

// Pre-approved chat messages that bypass obscenity moderation.
// Stored in normalized form (lowercase, trimmed, trailing single punctuation stripped
// where applicable — pure-punctuation entries stored as-is).
// Managed via POST /admin/refresh-config after external DB updates.
export const chatAllowlist = pgTable('chat_allowlist', {
	message: varchar('message', { length: 200 }).primaryKey(),
})

export const matchmakingMatches = pgTable('matchmaking_matches', {
	matchId: varchar('match_id', { length: 36 }).primaryKey(),
	lobbyCode: varchar('lobby_code', { length: 5 }).notNull().unique(),
	modId: varchar('mod_id', { length: 128 }).notNull(),
	gameMode: varchar('game_mode', { length: 128 }).notNull(),
	players: jsonb('players').notNull(),
	lobbyState: jsonb('lobby_state').notNull(),
	status: varchar('status', { length: 32 }).notNull().default('active'),
	// Server-stamped moment the run actually began — basis for server-measured
	// timing leaderboards (e.g. speedrun fastest time). NULL until the host starts.
	gameStartedAt: timestamp('game_started_at', { withTimezone: true }),
	// The authoritative, first-applied result (§11.6: "first report wins").
	// Persisted here (survives the in-memory match being torn down) so a LATER
	// report for the same matchId can be compared against it instead of just
	// 404ing -- a match, differing, no-op, or a matchResultConflicts row.
	resultPlacements: jsonb('result_placements'),
	resultReportedBy: text('result_reported_by'),
	resultReportedAt: timestamp('result_reported_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
})

// A second report for an already-resolved match whose placements don't match
// the first (authoritative) report. Per §21.5: the first report's outcome
// always stands automatically -- this is purely a flag for manual moderator
// review, never itself a trigger for a rating change.
export const matchResultConflicts = pgTable('match_result_conflicts', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	matchId: varchar('match_id', { length: 36 }).notNull(),
	lobbyCode: varchar('lobby_code', { length: 6 }).notNull(),
	firstReporterId: text('first_reporter_id').notNull(),
	firstPlacements: jsonb('first_placements').notNull(),
	conflictingReporterId: text('conflicting_reporter_id').notNull(),
	conflictingPlacements: jsonb('conflicting_placements').notNull(),
	status: varchar('status', { length: 16 }).notNull().default('open'), // open | resolved
	resolutionNotes: text('resolution_notes'),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
})

// A candidate "wrongful auto-forfeit" -- a player reconnected (MQTT or a
// fresh HTTP re-auth) shortly after a match involving them resolved via the
// grace-period auto-forfeit path (matchmaking_matches.result_reported_by =
// 'system'), which is exactly the race that let a legitimately-reconnected
// player still get forfeited (see grace-period.service.ts's GRACE_PERIOD_MS).
// Purely a flag for a moderator to review and, if it really was wrongful,
// void via void-match.ts's voidMatch() -- never an automatic rating change,
// since the reconnect timing alone isn't proof the forfeit was wrong (see
// RECONCILIATION_WINDOW_MS in matchmaking.service.ts).
export const forfeitReconciliationFlags = pgTable('forfeit_reconciliation_flags', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	matchId: varchar('match_id', { length: 36 }).notNull(),
	lobbyCode: varchar('lobby_code', { length: 6 }).notNull(),
	playerId: uuid('player_id').notNull(),
	forfeitedAt: timestamp('forfeited_at', { withTimezone: true }).notNull(),
	reconnectedAt: timestamp('reconnected_at', { withTimezone: true }).notNull(),
	status: varchar('status', { length: 16 }).notNull().default('open'), // open | voided | dismissed
	resolutionNotes: text('resolution_notes'),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
})

// Persisted mirror of grace-period.service.ts's in-memory `gracePeriods` Map
// -- a disconnected player's 2-minute countdown before auto-forfeit,
// durable across a bmp-api restart. No FK on playerId, same precedent as
// forfeitReconciliationFlags above: a grace period can involve a temp/dev
// account never written to `players` (see authenticateAsTemp).
export const gracePeriods = pgTable('grace_periods', {
	id: uuid('id').primaryKey().defaultRandom(),
	playerId: uuid('player_id').notNull(),
	lobbyCode: varchar('lobby_code', { length: 6 }).notNull(),
	displayName: text('display_name').notNull(),
	disconnectedAt: timestamp('disconnected_at', { withTimezone: true }).notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
})

export const matchmakingRatings = pgTable(
	'matchmaking_ratings',
	{
		playerId: uuid('player_id')
			.notNull()
			.references(() => players.id),
		modId: varchar('mod_id', { length: 128 }).notNull(),
		gameMode: varchar('game_mode', { length: 128 }).notNull(),
		season: integer('season').notNull(),
		rating: integer('rating').notNull().default(600),
		wins: integer('wins').notNull().default(0),
		losses: integer('losses').notNull().default(0),
		gamesPlayed: integer('games_played').notNull().default(0),
		// Secondary per-season personal best, ranked alongside (not instead of) rating.
		// Meaning is mod-defined (see metrics.config.ts): score for PvP (higher better),
		// duration in ms for speedrun (lower better). NULL until the player sets one.
		seasonBest: bigint('season_best', { mode: 'number' }),
		bestMatchId: varchar('best_match_id', { length: 36 }),
		bestAt: timestamp('best_at', { withTimezone: true }),
		lastMatchAt: timestamp('last_match_at', { withTimezone: true }),
		decayAppliedAt: timestamp('decay_applied_at', { withTimezone: true }),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.playerId, t.modId, t.gameMode, t.season] }),
		index('mmr_rating_idx').on(t.modId, t.gameMode, t.season, t.rating),
	],
)

export const leaderboardCache = pgTable(
	'leaderboard_cache',
	{
		modId: varchar('mod_id', { length: 128 }).notNull(),
		gameMode: varchar('game_mode', { length: 128 }).notNull(),
		season: integer('season').notNull(),
		rank: integer('rank').notNull(),
		playerId: uuid('player_id').notNull(),
		displayName: varchar('display_name', { length: 64 }).notNull(),
		rating: integer('rating').notNull(),
		wins: integer('wins').notNull(),
		losses: integer('losses').notNull(),
		gamesPlayed: integer('games_played').notNull(),
		// Cached copy of the player's secondary season best for display alongside rank.
		seasonBest: bigint('season_best', { mode: 'number' }),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.modId, t.gameMode, t.season, t.rank] }),
		index('lb_player_idx').on(t.modId, t.gameMode, t.season, t.playerId),
	],
)

export const seasons = pgTable('seasons', {
	id: serial('id').primaryKey(),
	name: varchar('name', { length: 64 }).notNull(),
	startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
	endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
	endedAt: timestamp('ended_at', { withTimezone: true }),
})

// Launcher release hosting -- the new-launcher repo (github.com/Balatro-Multiplayer/new-launcher)
// is private for anti-cheat reasons, so end users can't be pointed at its
// GitHub Releases page directly (no auth, and the repo itself must stay
// hidden). Its CI still builds and uploads every platform binary to a real
// (private) GitHub Release though, so this table stores a *reference* to
// that release's assets (see features/launcher-releases/launcher-github-releases.service.ts
// for the authenticated GitHub calls that resolve/proxy them) rather than
// hosting the bytes itself -- an earlier version of this table stored a
// local disk path per asset and required uploading every binary through
// this server's own admin UI, which hit Cloudflare's request-size cap when
// uploading multiple platforms together. Serves update-checks/downloads via
// the public GET /api/launcher/latest + /api/launcher/download/:version/:platform
// endpoints, unchanged by this switch. Replaces the old modReleases/modBranches
// ("mod_release"/"mod_branches") tables, which pointed at external GitHub-asset
// URLs directly (no per-asset id/hash tracking) -- dropped in the same
// migration that originally added these.
export const launcherPlatformEnum = pgEnum('launcher_platform', [
	'windows',
	'mac',
	'linux',
])
export type LauncherPlatform = (typeof launcherPlatformEnum.enumValues)[number]

// "Latest" is derived (highest id/createdAt), not an explicit flag -- there's
// no release-channel concept here (see launcherReleaseAssets below), just one
// linear version history.
export const launcherReleases = pgTable('launcher_release', {
	id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
	version: varchar('version', { length: 64 }).notNull().unique(),
	// The GitHub release tag this row was resolved from (e.g. "v0.2.0",
	// version above has the leading "v" stripped) -- needed to re-resolve
	// this release's assets later (the admin UI's "re-sync" action) without
	// the admin having to remember/retype which tag it came from.
	githubReleaseTag: varchar('github_release_tag', { length: 128 }).notNull(),
	notes: text('notes'),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
})

// One row per (release, platform) -- a GitHub release can be missing a
// platform (e.g. the Mac build failed that run), so this is a child table
// rather than three nullable column groups on launcherReleases, same as
// before. githubAssetId is GitHub's own numeric release-asset id, used to
// resolve a download via GET /repos/{owner}/{repo}/releases/assets/{id}
// (see launcher-github-releases.service.ts) -- no bytes live in this
// database or on this server's disk. sha256 comes from GitHub's own asset
// digest field and still lets a launcher verify its download before
// self-replacing, unchanged from before.
export const launcherReleaseAssets = pgTable(
	'launcher_release_asset',
	{
		id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
		releaseId: integer('release_id')
			.notNull()
			.references(() => launcherReleases.id, { onDelete: 'cascade' }),
		platform: launcherPlatformEnum('platform').notNull(),
		githubAssetId: integer('github_asset_id').notNull(),
		originalFilename: text('original_filename').notNull(),
		fileSize: integer('file_size').notNull(),
		sha256: varchar('sha256', { length: 64 }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		uniqueIndex('launcher_release_asset_release_platform_idx').on(
			t.releaseId,
			t.platform,
		),
	],
)

export const blogPostKindEnum = pgEnum('blog_post_kind', ['patch_notes', 'news'])
export type BlogPostKind = (typeof blogPostKindEnum.enumValues)[number]

export const blogPostStatusEnum = pgEnum('blog_post_status', [
	'draft',
	'published',
])
export type BlogPostStatus = (typeof blogPostStatusEnum.enumValues)[number]

// Patch notes / news posts, authored via the admin Blog page (Tiptap editor
// in apps/web, HTML sanitized server-side in features/webadmin/blog.route.ts
// before it ever reaches this table) and pulled by the launcher's
// GET /api/blog/latest (features/blog/blog.route.ts). "Latest per category"
// is derived (highest publishedAt among status='published' rows for that
// kind), not an explicit flag -- same "latest = most recent" precedent as
// launcherReleases above.
//
// status/publishedAt is a deliberate two-column draft/publish model rather
// than a single nullable timestamp: publishing always bumps publishedAt to
// now (so an unpublish-then-republish can become "latest" again), while
// unpublishing only flips status back to 'draft' and leaves publishedAt
// alone, so the admin UI can still show when a post was last live even
// while it's pulled back to draft.
export const blogPosts = pgTable('blog_post', {
	id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
	kind: blogPostKindEnum('kind').notNull(),
	title: varchar('title', { length: 200 }).notNull(),
	// Sanitized HTML only -- see blog.route.ts's allowlist, chosen to match
	// exactly what the launcher's QLabel rich-text engine can render.
	bodyHtml: text('body_html').notNull(),
	status: blogPostStatusEnum('status').notNull().default('draft'),
	publishedAt: timestamp('published_at', { withTimezone: true }),
	// Not a FK -- same pattern as actionLogs.playerId, so a deleted/altered
	// player row never blocks or cascade-deletes a historical post.
	authorPlayerId: text('author_player_id').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
})

// Three-tier moderation bans. One row per ban; a player may hold several active
// bans of different types simultaneously. A ban is ACTIVE while
// liftedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now()).
//   chat    — cannot send chat messages; can still play and queue
//   queue   — cannot join matchmaking; private lobbies unaffected
//   account — denied at MQTT CONNECT (game client); website login still works
export const playerBans = pgTable(
	'player_bans',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		// Intentionally NOT onDelete: 'cascade' — players are soft-deleted, never
		// hard-deleted, specifically so ban history survives account deletion
		// (defense in depth: any future code path that did hard-delete a players
		// row would fail loudly here instead of silently wiping ban records).
		playerId: uuid('player_id')
			.notNull()
			.references(() => players.id),
		banType: text('ban_type').notNull(), // 'chat' | 'queue' | 'account'
		expiresAt: timestamp('expires_at', { withTimezone: true }), // null = indefinite
		issuedBy: text('issued_by').notNull(), // moderator display name or 'system'
		issuedAt: timestamp('issued_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
		reason: text('reason').notNull().default(''),
		liftedAt: timestamp('lifted_at', { withTimezone: true }), // set when lifted early
		liftedBy: text('lifted_by'),
	},
	(t) => [index('player_bans_player_idx').on(t.playerId)],
)

// A durable, self-service mute: muterId suppresses mutedId's chat messages on
// their own client (never enforced server-side -- see mute.gateway.ts). Unlike
// player_bans, cascading on delete is correct here: a mute has no forensic/
// moderation value once either account is gone.
export const playerMutes = pgTable(
	'player_mutes',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		muterId: uuid('muter_id')
			.notNull()
			.references(() => players.id, { onDelete: 'cascade' }),
		mutedId: uuid('muted_id')
			.notNull()
			.references(() => players.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		uniqueIndex('player_mutes_pair_idx').on(t.muterId, t.mutedId),
		index('player_mutes_muter_idx').on(t.muterId),
	],
)

// One row per game run, any lobby type (matchmaking/private/practice). This is
// the anchor `matchRunLogs` hangs off of, since `matchmakingMatches` only
// exists for ranked/casual queue games and practice/private runs need an
// anchor too. Created the moment the server observes the first log event for
// a lobby (see features/replay-log), finalized when the run ends one way or
// another (result reported, host stops the game, or the lobby is abandoned).
export const lobbyRuns = pgTable(
	'lobby_runs',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		lobbyCode: varchar('lobby_code', { length: 6 }).notNull(),
		modId: varchar('mod_id', { length: 128 }).notNull(),
		lobbyType: varchar('lobby_type', { length: 16 }).notNull(), // 'public' | 'private'
		matchmakingMatchId: varchar('matchmaking_match_id', { length: 36 }),
		status: varchar('status', { length: 16 }).notNull().default('active'), // active | completed | abandoned | terminated
		startedAt: timestamp('started_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
		finalizedAt: timestamp('finalized_at', { withTimezone: true }),
	},
	(t) => [index('lobby_runs_lobby_code_idx').on(t.lobbyCode)],
)

// One row per (run, player) -- the compact replay/anti-cheat artifact itself.
// `compressedEvents` is the gzip+base64 block over the whole finalized carbon
// stream (manifest + events + END + CHK), per lib/replay_log.lua's Phase 2
// design: block-level compression, not per-event. `carbonHash` is the CHK
// value the client itself computed and broadcast (verbatim, not recomputed
// here) -- Phase 8's evaluateAntiCheat is what actually re-derives and
// compares it, recording the outcome in `flagReason`.
export const matchRunLogs = pgTable(
	'match_run_logs',
	{
		runId: uuid('run_id')
			.notNull()
			.references(() => lobbyRuns.id, { onDelete: 'cascade' }),
		playerId: text('player_id').notNull(),
		compressedEvents: text('compressed_events').notNull(),
		carbonHash: text('carbon_hash'),
		eventCount: integer('event_count').notNull().default(0),
		status: varchar('status', { length: 16 }).notNull().default('partial'), // partial | complete
		// null | 'hash_mismatch' | 'elapsed_time_gate' -- set by Phase 8's
		// evaluateAntiCheat at ranked result resolution. A non-null value forces
		// expiresAt to null (see below) regardless of the normal 30-day TTL.
		flagReason: varchar('flag_reason', { length: 32 }),
		finalizedAt: timestamp('finalized_at', { withTimezone: true }),
		expiresAt: timestamp('expires_at', { withTimezone: true }), // null = indefinite (flagged/disputed)
	},
	(t) => [primaryKey({ columns: [t.runId, t.playerId] })],
)

// One row per mod known to the platform -- populated by the hourly sync
// against skyline69/balatro-mod-index directly (features/mods/mods-sync.service.ts,
// upstream-mod-index.service.ts) and/or a direct admin edit via
// PUT /api/webadmin/mods/:modId. This is the launcher-facing catalog
// (GET /api/mods, /api/mods/:id) -- distinct from launcherReleases/
// launcherReleaseAssets above, which is the unrelated launcher binary/update
// channel (a different piece of software from the mods this table tracks).
export const modRegistry = pgTable('mod_registry', {
	// Slug form "Author@ModName", matching upstream's folder-name convention.
	id: varchar('id', { length: 128 }).primaryKey(),
	title: varchar('title', { length: 128 }).notNull(),
	author: varchar('author', { length: 128 }).notNull(),
	categories: text('categories').array().notNull().default(sql`'{}'::text[]`),
	requiresSteamodded: boolean('requires_steamodded').notNull().default(true),
	requiresTalisman: boolean('requires_talisman').notNull().default(false),
	repoUrl: text('repo_url'),
	thumbnailUrl: text('thumbnail_url'),
	description: text('description'),
	latestVersion: varchar('latest_version', { length: 64 }),
	latestDownloadUrl: text('latest_download_url'),
	latestSha256: varchar('latest_sha256', { length: 64 }),
	// Admin-owned, not synced from the index -- the upstream index carries no
	// ranked-eligibility concept of its own. The sole source of ranked
	// eligibility: null means this mod is not ranked-allowed; a set value
	// means it's ranked-allowed and pinned to exactly that version -- there
	// is no "any version is fine" state. Enforced at write time (see
	// setRankedVersion/webadmin mods.route.ts's PUT handler), not via a DB
	// CHECK: a custom-sourced mod (see mod-source-classifier.ts's
	// ModSourceType) can never be set here at all; a branch-sourced mod can
	// only be pinned to its current latestVersion (a branch archive URL
	// always re-resolves to current HEAD, so an old value is unfetchable);
	// only a release-sourced mod can be pinned to any of its historical
	// mod_registry_versions entries, since those stay individually
	// fetchable forever. Consumed by modProfileEntries' 'latestRanked'
	// versionMode below.
	rankedVersion: varchar('ranked_version', { length: 64 }),
	// Admin-owned highlight flag, same "never synced from the index" shape as
	// rankedVersion above -- the index carries no concept of this at all.
	featured: boolean('featured').notNull().default(false),
	// Admin-owned, same "never synced from the index" shape as featured above
	// -- excludes this mod from the public GET /api/mods catalog (launcher/
	// website) while keeping it manageable on /admin/ranked-mods. For a mod
	// an admin wants out of players' hands without deleting it outright (e.g.
	// a dead-repo mod that can no longer be verified).
	hidden: boolean('hidden').notNull().default(false),
	// True for a mod created directly by an admin (e.g. via the "New mod"
	// button on /admin/ranked-mods) with no base-index counterpart at all --
	// pruneModsMissingFrom must never delete these just because they aren't
	// in the freshly-fetched index.
	isCustom: boolean('is_custom').notNull().default(false),
	// Opt-in per custom mod (isCustom rows only -- ignored otherwise, since a
	// synced mod's version tracking is entirely upstream's own concern).
	// custom-mod-version-check.service.ts's source-resolution logic against
	// latestDownloadUrl/fixedReleaseTagUpdates, a TS port of upstream's own
	// update_mod_versions.py. Both default false so every custom mod that
	// existed before this feature shipped keeps its current fully-manual
	// behavior until an admin explicitly opts in.
	automaticVersionCheck: boolean('automatic_version_check')
		.notNull()
		.default(false),
	// Mirrors upstream meta.json's fixed-release-tag-updates: track the tag of
	// the specific release asset referenced by latestDownloadUrl, rather than
	// the repo's overall latest release. Only meaningful alongside
	// automaticVersionCheck=true and a /releases/download/ latestDownloadUrl;
	// otherwise ignored (falls back to "no update found", not an error).
	fixedReleaseTagUpdates: boolean('fixed_release_tag_updates')
		.notNull()
		.default(false),
	// Names of this row's own fields (title, description, thumbnailUrl, etc.
	// -- the syncable fields upsertModFromIndex would otherwise overwrite)
	// that an admin has directly edited via PATCH /api/webadmin/mods/:modId.
	// A field named here is skipped on every future sync until an admin
	// explicitly reverts it (POST .../reset-overrides) -- unlike
	// rankedVersion/featured/hidden, these fields *do* have an
	// upstream value and should keep tracking it right up until the point an
	// admin overrides one. Meaningless for isCustom rows (never touched by
	// sync in the first place).
	overriddenFields: text('overridden_fields')
		.array()
		.notNull()
		.default(sql`'{}'::text[]`),
	sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
})

// Historical per-version hashes -- a mod_profile_entries row can pin an exact
// past version (not just "latest"), so latestSha256 above alone isn't enough.
export const modRegistryVersions = pgTable(
	'mod_registry_versions',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		modId: varchar('mod_id', { length: 128 })
			.notNull()
			.references(() => modRegistry.id, { onDelete: 'cascade' }),
		version: varchar('version', { length: 64 }).notNull(),
		sha256: varchar('sha256', { length: 64 }),
		downloadUrl: text('download_url'),
		releasedAt: timestamp('released_at', { withTimezone: true }),
	},
	(t) => [
		uniqueIndex('mod_registry_versions_mod_version_idx').on(t.modId, t.version),
	],
)

// Admin-authored named allowlists ("ranked mod profiles"). Info-only for now
// (§ranked-mod-enforcement in the plan) -- nothing cross-checks a client's
// actual installed mods against a profile at queue time yet; this is the data
// the launcher/website read to decide what to install/allow client-side.
export const modProfiles = pgTable('mod_profiles', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: varchar('name', { length: 128 }).notNull(),
	slug: varchar('slug', { length: 128 }).notNull().unique(),
	description: text('description'),
	createdBy: uuid('created_by').references(() => players.id),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
})

// The three ways a profile entry can pin a mod's version: an exact string
// (pairs with pinnedVersion below), always resolve to whatever's newest, or
// always resolve to modRegistry.rankedVersion (the admin-pinned "known good
// for ranked" build). Replaces the old free-text versionConstraint
// ('any'/exact/'min:<version>') -- that scheme required app-level parsing
// with no fixed vocabulary; this is a closed set the launcher can switch on.
export const modProfileVersionModeEnum = pgEnum('mod_profile_version_mode', [
	'exact',
	'latest',
	'latestRanked',
])
export type ModProfileVersionMode =
	(typeof modProfileVersionModeEnum.enumValues)[number]

export const modProfileEntries = pgTable(
	'mod_profile_entries',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		profileId: uuid('profile_id')
			.notNull()
			.references(() => modProfiles.id, { onDelete: 'cascade' }),
		modId: varchar('mod_id', { length: 128 })
			.notNull()
			.references(() => modRegistry.id, { onDelete: 'cascade' }),
		versionMode: modProfileVersionModeEnum('version_mode')
			.notNull()
			.default('latest'),
		// Only meaningful when versionMode is 'exact' -- ignored otherwise.
		pinnedVersion: varchar('pinned_version', { length: 64 }),
		// Lets a profile explicitly blocklist a mod rather than only allowlist.
		allowed: boolean('allowed').notNull().default(true),
	},
	(t) => [
		uniqueIndex('mod_profile_entries_profile_mod_idx').on(t.profileId, t.modId),
	],
)

// One row per launcher-integrity challenge that wasn't cleanly answered
// (wrong response, timed out, or -- login challenges only -- explicitly
// refused). Mirrors match_run_logs.flagReason's flag-for-moderator-review
// shape: this table is an audit trail, not itself a ban -- account-level
// action against a repeat offender stays a manual moderator call.
export const launcherIntegrityEvents = pgTable(
	'launcher_integrity_events',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		playerId: uuid('player_id')
			.notNull()
			.references(() => players.id),
		kind: varchar('kind', { length: 16 }).notNull(), // 'login' | 'periodic'
		reason: varchar('reason', { length: 16 }).notNull(), // 'wrong_response' | 'timeout' | 'refused'
		occurredAt: timestamp('occurred_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [index('launcher_integrity_events_player_idx').on(t.playerId)],
)

// One row per (player, hardware component) the launcher has ever attested to,
// submitted only alongside a launcher-integrity LOGIN challenge (never
// periodic -- see launcher-integrity.service.ts's handleChallengeResponse)
// and only once that challenge's signature has already verified. Almost
// every componentHash is an HMAC-SHA256 the launcher computed locally
// (hardwarefingerprint.cpp) -- the raw hardware identifier never leaves the
// player's machine, this table only ever sees the hash -- except
// 'serverside_connection_id', a deliberate exception: it reproduces the old
// BalatroMultiplayer mod's own unkeyed hash byte-for-byte so it can be
// cross-referenced against that legacy system's own ban data (see
// hardwarefingerprint.cpp's legacyEncryptString() comment for why). Indexed
// on componentName+componentHash for the cross-player fuzzy-match/ban-
// evasion query this backs (findBanEvasionMatches()).
export const playerHardwareFingerprints = pgTable(
	'player_hardware_fingerprints',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		playerId: uuid('player_id')
			.notNull()
			.references(() => players.id),
		platform: varchar('platform', { length: 16 }).notNull(), // 'windows' | 'macos' | 'linux'
		componentName: varchar('component_name', { length: 32 }).notNull(), // e.g. 'steam_id', 'disk_serial'
		componentHash: varchar('component_hash', { length: 64 }).notNull(), // hex HMAC-SHA256 (unkeyed FNV-1a for 'serverside_connection_id' - see table comment)
		firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		// Re-submission (every Ranked Run re-collects and re-sends) updates the
		// same row rather than growing unboundedly -- see upsertHardwareComponents.
		uniqueIndex('player_hardware_fingerprints_player_component_idx').on(
			t.playerId,
			t.componentName,
		),
		index('player_hardware_fingerprints_component_idx').on(
			t.componentName,
			t.componentHash,
		),
	],
)
