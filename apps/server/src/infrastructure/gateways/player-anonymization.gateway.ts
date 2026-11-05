import { type SQL, sql } from 'drizzle-orm'
import {
	DELETED_PLAYER_ID,
	DELETED_PLAYER_NAME,
} from '../../shared/deleted-player.js'
import { db } from '../db/index.js'

// Account deletion (Notice decision 17), in one transaction. Each column that
// can hold a player id is one of three kinds of data:
// - own: only the player's (profile, ratings, normal chat, run logs): deleted.
// - shared: a game that also belongs to other players: the player's side
//   takes DELETED_PLAYER_ID, one standard id shared by every deleted player,
//   so the other players' history stays whole.
// - moderation: bans, reports, warnings, queue items and evidence: kept under
//   a random anonymous id, made per deletion. A login with the same Steam
//   identity gets this row back when it kept the Steam ID hash (a ban record).
// Nakama does the same to its storage first (nakama/src/player/anonymize.ts),
// with the same ids.
//
// Every column of the schema is listed below, either as a place a player id
// can be or as one that holds none; tests/gateways/player-anonymization.test.ts
// fails on a column in neither list, so a new table cannot be forgotten.

// id: the column holds exactly a player id.
// text / json: a player id can be inside the value ('admin:<id>',
//   '<runId>:<id>', a JSON document); every occurrence is replaced. Player
//   ids are UUIDs, so a plain text replace cannot hit anything else.
export type PlayerIdColumnKind = 'id' | 'text' | 'json'
export type PlayerData = 'own' | 'shared' | 'moderation'
// Own rows that are moderation evidence all the same, kept under the
// anonymous id: flagged chat, and the run logs an open report or ban uses.
export type KeptEvidence = 'flagged_chat' | 'kept_runs'

export interface PlayerIdColumn {
	table: string
	column: string
	kind: PlayerIdColumnKind
	data: PlayerData
	evidence?: KeptEvidence
}

export const PLAYER_ID_COLUMNS: readonly PlayerIdColumn[] = [
	{ table: 'refresh_tokens', column: 'player_id', kind: 'id', data: 'own' },
	{ table: 'player_mutes', column: 'muter_id', kind: 'id', data: 'own' },
	// A mute of a deleted player mutes nobody.
	{ table: 'player_mutes', column: 'muted_id', kind: 'id', data: 'own' },
	{ table: 'game_results', column: 'players', kind: 'json', data: 'shared' },
	{ table: 'game_results', column: 'result', kind: 'json', data: 'shared' },
	{
		table: 'chat_logs',
		column: 'player_id',
		kind: 'id',
		data: 'own',
		evidence: 'flagged_chat',
	},
	{ table: 'action_logs', column: 'player_id', kind: 'id', data: 'own' },
	{ table: 'action_logs', column: 'payload', kind: 'json', data: 'shared' },
	{
		table: 'flagged_messages',
		column: 'player_id',
		kind: 'id',
		data: 'moderation',
	},
	{ table: 'reports', column: 'reporter_id', kind: 'id', data: 'moderation' },
	{ table: 'reports', column: 'reported_id', kind: 'id', data: 'moderation' },
	{
		table: 'reported_lobby_messages',
		column: 'player_id',
		kind: 'id',
		data: 'moderation',
	},
	{
		table: 'matchmaking_matches',
		column: 'players',
		kind: 'json',
		data: 'shared',
	},
	{
		table: 'matchmaking_matches',
		column: 'lobby_state',
		kind: 'json',
		data: 'shared',
	},
	{
		table: 'matchmaking_matches',
		column: 'result_placements',
		kind: 'json',
		data: 'shared',
	},
	{
		table: 'matchmaking_matches',
		column: 'result_reported_by',
		kind: 'text',
		data: 'shared',
	},
	{
		table: 'match_result_conflicts',
		column: 'first_reporter_id',
		kind: 'id',
		data: 'moderation',
	},
	{
		table: 'match_result_conflicts',
		column: 'first_placements',
		kind: 'json',
		data: 'moderation',
	},
	{
		table: 'match_result_conflicts',
		column: 'conflicting_reporter_id',
		kind: 'id',
		data: 'moderation',
	},
	{
		table: 'match_result_conflicts',
		column: 'conflicting_placements',
		kind: 'json',
		data: 'moderation',
	},
	{
		table: 'forfeit_reconciliation_flags',
		column: 'player_id',
		kind: 'id',
		data: 'moderation',
	},
	{
		table: 'service_queue_items',
		column: 'source_id',
		kind: 'text',
		data: 'moderation',
	},
	{
		table: 'service_queue_items',
		column: 'subject_player_id',
		kind: 'id',
		data: 'moderation',
	},
	{
		table: 'service_queue_items',
		column: 'summary',
		kind: 'text',
		data: 'moderation',
	},
	{
		table: 'service_queue_items',
		column: 'resolved_by',
		kind: 'text',
		data: 'moderation',
	},
	{
		table: 'service_queue_items',
		column: 'claimed_by',
		kind: 'text',
		data: 'moderation',
	},
	{
		table: 'service_queue_items',
		column: 'context',
		kind: 'json',
		data: 'moderation',
	},
	{
		table: 'service_queue_item_events',
		column: 'actor',
		kind: 'text',
		data: 'moderation',
	},
	{
		table: 'service_queue_item_events',
		column: 'detail',
		kind: 'json',
		data: 'moderation',
	},
	{
		table: 'player_warnings',
		column: 'player_id',
		kind: 'id',
		data: 'moderation',
	},
	{
		table: 'player_warnings',
		column: 'issued_by',
		kind: 'text',
		data: 'moderation',
	},
	{
		table: 'player_warnings',
		column: 'lifted_by',
		kind: 'text',
		data: 'moderation',
	},
	{ table: 'contests', column: 'contester_id', kind: 'id', data: 'moderation' },
	{ table: 'contests', column: 'against_id', kind: 'id', data: 'moderation' },
	{ table: 'contests', column: 'detail', kind: 'text', data: 'moderation' },
	{ table: 'appeals', column: 'player_id', kind: 'id', data: 'moderation' },
	{ table: 'appeals', column: 'message', kind: 'text', data: 'moderation' },
	{ table: 'appeals', column: 'decision_reason', kind: 'text', data: 'moderation' },
	{ table: 'appeals', column: 'decided_by', kind: 'text', data: 'moderation' },
	{ table: 'staff_log', column: 'staff_player_id', kind: 'id', data: 'moderation' },
	{ table: 'staff_log', column: 'target_player_id', kind: 'id', data: 'moderation' },
	{ table: 'staff_log', column: 'reason', kind: 'text', data: 'moderation' },
	{ table: 'staff_log', column: 'detail', kind: 'json', data: 'moderation' },
	{ table: 'player_notes', column: 'player_id', kind: 'id', data: 'moderation' },
	{ table: 'player_notes', column: 'author_id', kind: 'id', data: 'moderation' },
	{ table: 'player_notes', column: 'note', kind: 'text', data: 'moderation' },
	{ table: 'player_strikes', column: 'player_id', kind: 'id', data: 'moderation' },
	{ table: 'grace_periods', column: 'player_id', kind: 'id', data: 'own' },
	{
		table: 'matchmaking_ratings',
		column: 'player_id',
		kind: 'id',
		data: 'own',
	},
	{ table: 'leaderboard_cache', column: 'player_id', kind: 'id', data: 'own' },
	// Site content other people read: kept, by the standard id.
	{
		table: 'blog_post',
		column: 'author_player_id',
		kind: 'id',
		data: 'shared',
	},
	{ table: 'player_bans', column: 'player_id', kind: 'id', data: 'moderation' },
	{
		table: 'player_bans',
		column: 'issued_by',
		kind: 'text',
		data: 'moderation',
	},
	{
		table: 'player_bans',
		column: 'lifted_by',
		kind: 'text',
		data: 'moderation',
	},
	{
		table: 'match_run_logs',
		column: 'player_id',
		kind: 'id',
		data: 'own',
		evidence: 'kept_runs',
	},
	{ table: 'mod_profiles', column: 'created_by', kind: 'id', data: 'shared' },
	{
		table: 'launcher_integrity_events',
		column: 'player_id',
		kind: 'id',
		data: 'moderation',
	},
]

// Columns that never hold a player id, by table. The players row itself is
// replaced whole (see anonymizationStatements). Free text written by
// moderators (notes, messages) is not searched.
const NO_PLAYER_ID: { readonly [table: string]: readonly string[] } = {
	players: [
		'id',
		'steam_id_hash',
		'discord_id_hash',
		'discord_username',
		'use_discord_name',
		'preferred_joker',
		'privileges',
		'steam_name',
		'chat_enabled',
		'chat_blocked',
		'tos_accepted_version',
		'notice_accepted_at',
		'created_at',
		'updated_at',
		'deleted_at',
		'nakama_user_id',
	],
	refresh_tokens: ['id', 'token_hash', 'expires_at', 'created_at'],
	game_results: ['id', 'lobby_code', 'mod_id', 'started_at', 'ended_at'],
	chat_logs: [
		'id',
		'lobby_code',
		'moderation_id',
		'message',
		'flagged',
		'expires_at',
		'moderation_verdict',
		'sent_at',
		'mirror_key',
		'lobby_id',
	],
	action_logs: ['id', 'lobby_code', 'action_type', 'created_at'],
	server_config: [
		'id',
		'tos_version',
		'chat_enabled',
		'ranked_enabled',
		'casual_queue_enabled',
		'group_queue_enabled',
		'lobby_creation_enabled',
		'achievements_enabled',
		'chat_ladder_steps',
		'play_ladder_steps',
		'updated_at',
	],
	preset_reasons: ['item_type', 'reasons', 'updated_at'],
	mod_versions: [
		'mod_id',
		'display_name',
		'version',
		'download_url',
		'updated_at',
	],
	flagged_messages: [
		'id',
		'message',
		'matches',
		'flagged_at',
		'expires_at',
		'mirror_key',
	],
	chat_review_labels: [
		'id',
		'item_id',
		'flagged_message_id',
		'message',
		'context',
		'score',
		'band',
		'label',
		'decided_at',
	],
	reports: [
		'id',
		'lobby_id',
		'lobby_code',
		'type',
		'run_id',
		'status',
		'message',
		'additional_detail',
		'page_opened_at',
		'withdrawn_at',
		'created_at',
	],
	reported_lobby_messages: [
		'id',
		'lobby_id',
		'lobby_code',
		'display_name',
		'message',
		'sent_at',
		'expires_at',
	],
	chat_allowlist: ['message'],
	matchmaking_matches: [
		'match_id',
		'lobby_code',
		'mod_id',
		'game_mode',
		'status',
		'game_started_at',
		'result_reported_at',
		'created_at',
		'updated_at',
	],
	match_result_conflicts: [
		'id',
		'match_id',
		'lobby_code',
		'status',
		'resolution_notes',
		'created_at',
	],
	forfeit_reconciliation_flags: [
		'id',
		'match_id',
		'lobby_code',
		'forfeited_at',
		'reconnected_at',
		'status',
		'resolution_notes',
		'created_at',
	],
	service_queue_items: [
		'id',
		'item_type',
		'status',
		'priority',
		'created_at',
		'resolved_at',
		'resolution_action',
		'resolution_notes',
		'claimed_until',
		'updated_at',
	],
	service_queue_item_events: ['id', 'item_id', 'kind', 'action', 'note', 'at'],
	player_warnings: ['id', 'item_id', 'message', 'issued_at', 'lifted_at'],
	appeals: [
		'id',
		'target_kind',
		'punishment_id',
		'network_ban_ids',
		'status',
		'outcome',
		'decided_at',
		'created_at',
	],
	contests: ['id', 'run_id', 'kind', 'reason', 'page_opened_at', 'withdrawn_at', 'created_at'],
	staff_log: ['id', 'staff_role', 'action', 'item_id', 'at'],
	player_notes: ['id', 'created_at'],
	player_strikes: ['id', 'ban_id', 'warning_id', 'ladder', 'recommended_step', 'applied_step', 'deviation_reason', 'issued_at'],
	grace_periods: [
		'id',
		'lobby_code',
		'display_name',
		'disconnected_at',
		'expires_at',
		'created_at',
	],
	matchmaking_ratings: [
		'mod_id',
		'game_mode',
		'season',
		'rating',
		'wins',
		'losses',
		'games_played',
		'season_best',
		'season_best_len',
		'season_best_rev',
		'season_best_text',
		'best_match_id',
		'best_at',
		'last_match_at',
		'decay_applied_at',
		'updated_at',
	],
	leaderboard_cache: [
		'mod_id',
		'game_mode',
		'season',
		'rank',
		'display_name',
		'rating',
		'wins',
		'losses',
		'games_played',
		'season_best',
		'updated_at',
	],
	seasons: ['id', 'name', 'started_at', 'ends_at', 'ended_at'],
	// The owner's id, and a copy of one Season board in a JSON column. It is kept
	// whole so a restore puts the board back as it was.
	season_replay_backups: ['id', 'season', 'created_by', 'created_at', 'data'],
	launcher_release: [
		'id',
		'version',
		'github_release_tag',
		'notes',
		'created_at',
		'updated_at',
	],
	launcher_release_asset: [
		'id',
		'release_id',
		'platform',
		'github_asset_id',
		'original_filename',
		'file_size',
		'sha256',
		'created_at',
	],
	blog_post: [
		'id',
		'kind',
		'title',
		'body_html',
		'status',
		'published_at',
		'created_at',
		'updated_at',
	],
	player_bans: [
		'id',
		'ban_type',
		'expires_at',
		'issued_at',
		'reason',
		'lifted_at',
	],
	player_mutes: ['id', 'created_at'],
	lobby_runs: [
		'id',
		'lobby_code',
		'mod_id',
		'lobby_type',
		'matchmaking_match_id',
		'status',
		'started_at',
		'finalized_at',
	],
	match_run_logs: [
		'run_id',
		'compressed_events',
		'carbon_hash',
		'event_count',
		'status',
		'flag_reason',
		'finalized_at',
		'expires_at',
		'shared_at',
	],
	mod_registry: [
		'id',
		'thunderstore_full_name',
		'title',
		'author',
		'categories',
		'is_custom',
		'automatic_version_check',
		'fixed_release_tag_updates',
		'search_terms',
		'requires_steamodded',
		'requires_talisman',
		'repo_url',
		'thumbnail_url',
		'description',
		'package_url',
		'donation_link',
		'latest_version',
		'latest_download_url',
		'ranked_version',
		'ranked_version_sha256',
		'smods_ids',
		'smods_ids_read_version',
		'ranked_download_url',
		'ranked_source',
		'ranked_download_status',
		'ranked_checked_at',
		'track_github',
		'featured',
		'hidden',
		'source_updated_at',
		'created_at',
		'updated_at',
	],
	mod_registry_versions: [
		'id',
		'mod_id',
		'version',
		'download_url',
		'released_at',
		'source',
		'aliases',
		'ref',
		'dependencies',
	],
	mod_profiles: [
		'id',
		'name',
		'slug',
		'description',
		'created_at',
		'updated_at',
	],
	mod_profile_entries: [
		'id',
		'profile_id',
		'mod_id',
		'version_mode',
		'pinned_version',
		'allowed',
	],
	launcher_integrity_events: ['id', 'kind', 'reason', 'occurred_at'],
}

export const NO_PLAYER_ID_COLUMNS: readonly string[] = Object.entries(
	NO_PLAYER_ID,
).flatMap(([table, columns]) => columns.map((column) => `${table}.${column}`))

const id = (name: string) => sql.identifier(name)

function replaceStatement(
	c: PlayerIdColumn,
	playerId: string,
	to: string,
): SQL {
	const table = id(c.table)
	const column = id(c.column)
	if (c.kind === 'id')
		return sql`update ${table} set ${column} = ${to} where ${column} = ${playerId}`
	if (c.kind === 'text')
		return sql`update ${table} set ${column} = replace(${column}, ${playerId}, ${to}) where strpos(${column}, ${playerId}) > 0`
	return sql`update ${table} set ${column} = replace(${column}::text, ${playerId}, ${to})::jsonb where strpos(${column}::text, ${playerId}) > 0`
}

// The own rows kept as evidence, as a condition; null when none are.
function evidenceCondition(
	evidence: KeptEvidence,
	keptRunIds: readonly string[],
): SQL | null {
	if (evidence === 'flagged_chat') return sql`"flagged" = true`
	if (keptRunIds.length === 0) return null
	return sql`"run_id" in (${sql.join(
		keptRunIds.map((r) => sql`${r}`),
		sql`, `,
	)})`
}

function columnStatements(
	c: PlayerIdColumn,
	playerId: string,
	anonymousId: string,
	keptRunIds: readonly string[],
): SQL[] {
	if (c.data === 'shared')
		return [replaceStatement(c, playerId, DELETED_PLAYER_ID)]
	if (c.data === 'moderation')
		return [replaceStatement(c, playerId, anonymousId)]
	const table = id(c.table)
	const column = id(c.column)
	const statements: SQL[] = []
	const kept = c.evidence ? evidenceCondition(c.evidence, keptRunIds) : null
	if (kept)
		statements.push(
			sql`update ${table} set ${column} = ${anonymousId} where ${column} = ${playerId} and ${kept}`,
		)
	statements.push(sql`delete from ${table} where ${column} = ${playerId}`)
	return statements
}

// Every statement of one deletion, in order. keptSteamIdHash is the peppered
// Steam ID hash the anonymous row keeps for ban enforcement, or null.
// keptRunIds are the runs an open report or ban uses. Pure.
export function anonymizationStatements(
	playerId: string,
	anonymousId: string,
	keptSteamIdHash: string | null,
	keptRunIds: readonly string[],
): SQL[] {
	const statements: SQL[] = [
		// The standard row every deleted player's shared games point at, made
		// by the first deletion. Its nakama_user_id is the same id, as Nakama
		// names it so.
		sql`insert into "players" ("id", "steam_name", "nakama_user_id", "deleted_at") values (${DELETED_PLAYER_ID}, ${DELETED_PLAYER_NAME}, ${DELETED_PLAYER_ID}, now()) on conflict do nothing`,
		// Frees the unique hash and Nakama id for the new row.
		sql`update "players" set "steam_id_hash" = null, "discord_id_hash" = null, "nakama_user_id" = null where "id" = ${playerId}`,
		// nakama_user_id is the anonymous id too: Nakama renamed the player to
		// it, so a mirror entry still on its way lands on this row.
		sql`insert into "players" ("id", "steam_name", "steam_id_hash", "nakama_user_id", "deleted_at") values (${anonymousId}, ${DELETED_PLAYER_NAME}, ${keptSteamIdHash}, ${anonymousId}, now())`,
	]
	for (const c of PLAYER_ID_COLUMNS)
		statements.push(...columnStatements(c, playerId, anonymousId, keptRunIds))
	statements.push(
		sql`update "reported_lobby_messages" set "display_name" = ${DELETED_PLAYER_NAME} where "player_id" = ${anonymousId}`,
	)
	statements.push(
		sql`update "matchmaking_matches" set "lobby_state" = jsonb_set("lobby_state", array['playerInfos', ${DELETED_PLAYER_ID}, 'displayName'], to_jsonb(${DELETED_PLAYER_NAME}::text)) where "lobby_state" -> 'playerInfos' -> ${DELETED_PLAYER_ID} is not null`,
	)
	if (keptSteamIdHash === null)
		statements.push(
			sql`update "chat_logs" set "moderation_id" = null where "player_id" = ${anonymousId}`,
		)
	statements.push(sql`delete from "players" where "id" = ${playerId}`)
	return statements
}

// What a deletion needs to know before it starts (auth.service deleteAccount):
// the runs the player has a log in or a report on, and whether they have a
// ban record (then the anonymous row keeps their Steam ID hash).
export async function deletionFacts(
	playerId: string,
): Promise<{ runIds: string[]; hasBanRecord: boolean }> {
	const runs = await db.execute(
		sql`select "run_id"::text as "run_id" from "match_run_logs" where "player_id" = ${playerId} union select "run_id"::text from "reports" where "run_id" is not null and (${playerId} in ("reporter_id", "reported_id"))`,
	)
	const bans = await db.execute(
		sql`select exists (select 1 from "player_bans" where "player_id" = ${playerId}) as "banned"`,
	)
	return {
		runIds: (runs.rows as { run_id: string }[]).map((r) => r.run_id),
		hasBanRecord:
			(bans.rows[0] as { banned: boolean } | undefined)?.banned === true,
	}
}

// Deletes or moves every row of playerId in Postgres (see the top). The
// peppered Steam ID hash stays on the anonymous row only when the player has
// a ban record (it enforces the ban on a new account;
// the hourly purgeDeletedPlayerHashes clears it later). A player id with no row
// still has its other rows handled.
export async function anonymizePlayer(
	playerId: string,
	anonymousId: string,
	keptRunIds: readonly string[],
): Promise<void> {
	await db.transaction(async (tx) => {
		const found = await tx.execute(
			sql`select "steam_id_hash", exists (select 1 from "player_bans" where "player_id" = ${playerId}) as "banned" from "players" where "id" = ${playerId} for update`,
		)
		const row = found.rows[0] as
			| { steam_id_hash: string | null; banned: boolean }
			| undefined
		const kept = row?.banned ? row.steam_id_hash : null
		for (const statement of anonymizationStatements(
			playerId,
			anonymousId,
			kept,
			keptRunIds,
		))
			await tx.execute(statement)
	})
}
