import { sql } from 'drizzle-orm'
import {
	boolean,
	index,
	integer,
	jsonb,
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
		preferredJoker: varchar('preferred_joker', { length: 64 }).notNull().default('j_joker'),
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
	flaggedAt: timestamp('flagged_at', { withTimezone: true }).notNull().defaultNow(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const reports = pgTable('reports', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	// Unique per lobby instance — same code can be reused across different lobbies
	lobbyId: uuid('lobby_id').notNull(),
	lobbyCode: varchar('lobby_code', { length: 6 }).notNull(),
	reporterId: text('reporter_id').notNull(),
	reportedId: text('reported_id').notNull(),
	// Client-defined category string (e.g. "harassment", "cheating")
	type: varchar('type', { length: 64 }).notNull(),
	message: text('message'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
		lastMatchAt: timestamp('last_match_at', { withTimezone: true }),
		decayAppliedAt: timestamp('decay_applied_at', { withTimezone: true }),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
