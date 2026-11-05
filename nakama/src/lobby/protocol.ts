// Wire protocol between MPAPI (networking/nakama_lobby.lua) and the bmp_lobby
// match. Every payload is JSON. Op codes are plain objects rather than enums:
// isolatedModules builds can't inline const enums.
import type { TellOutcome } from '../notification/kinds'
import type { QueueRefusalCode } from '../matchmaking/queue_refusal'
import type { AccountStanding, RequiredStanding } from '../standing/standing'

export const LOBBY_MATCH = 'bmp_lobby'

export const ClientOp = {
	// {} -- leave for good (not a disconnect: no grace period).
	LEAVE: 1,
	// {playerId} -- host only.
	KICK: 2,
	// {metadata} -- host only; shallow-merged into the lobby metadata.
	SET_METADATA: 3,
	// {state} -- the sender's own state, handed back in the snapshot on rejoin.
	SET_STATE: 4,
	// ActionMessage -- a relayed action (to a player id or '*'), or an
	// authoritative one (to 'server').
	ACTION: 5,
	// {catchingUp} -- the sender is (or is no longer) replaying its own run
	// after a crash. The seat is safe either way: nothing waits for it.
	CATCHING_UP: 6,
	// {playerId, fromStart?} -- a spectator asks for the run of the player it watches: that
	// player's Run save and the events after it (answered with SPECTATE_RUN).
	// fromStart asks for the whole log and no Run save.
	SPECTATE_VIEW: 7,
} as const

export const ServerOp = {
	// Snapshot, to the joining player only.
	SNAPSHOT: 100,
	// LobbyEventMessage, same shape as the API's lobby/{code}/events payloads.
	EVENT: 101,
	// The full metadata object.
	METADATA: 102,
	// {playerId, info} -- info is null when the player is gone.
	PLAYER_INFO: 103,
	// {message}, to the sender of a rejected op.
	ERROR: 104,
	// ActionEnvelope -- a relayed action, or an authoritative action's result
	// (from 'server').
	ACTION: 105,
	// {cid, action, reason}, to the sender of a refused ACTION.
	ACTION_REJECTED: 106,
	// {senderId, displayName, message}: a chat line, to everyone seated.
	CHAT: 107,
	// SpectateSnapshot, to a spectator once it has joined.
	SPECTATE_SNAPSHOT: 108,
	// SpectateEvent: one participant's replay event, to every spectator.
	SPECTATE_EVENT: 109,
	// {graceSeconds}, to everyone: the server is restarting. The lobby comes
	// back under the same code; rejoin once the server is up.
	SERVER_RESTARTING: 110,
	// ReplayTail, to a participant rejoining a running game: what the others
	// logged, so its view of them catches up.
	REPLAY_TAIL: 111,
	// GroupQueueMessage, to the home lobby's players: its group queue moved on
	// (matchmaking/group).
	GROUP_QUEUE: 112,
	// SpectateRun, to the spectator that asked (ClientOp.SPECTATE_VIEW).
	SPECTATE_RUN: 113,
} as const

// Where an ACTION goes: a player id, '*' for everyone (the sender included),
// or SERVER_TARGET for an authoritative action.
export const BROADCAST_TARGET = '*'
export const SERVER_TARGET = 'server'

// What a client sends. `from` is never read: the server stamps the sender.
export interface ActionMessage {
	cid: string
	action: string
	to: string
	params: unknown
	responseTo?: string
}

// What a client receives.
export interface ActionEnvelope {
	cid: string
	action: string
	from: string
	to: string
	params: unknown
	responseTo?: string
}

export interface ActionRejection {
	cid: string
	action: string
	reason: string
}

// One player's finishing position, as every participant reports it.
export interface Placement {
	playerId: string
	place: number
	performance?: number
	metric?: number
	// The season best as score text, in canonical form.
	metricText?: string
}

// A participant of a started game, captured at the start (they may leave).
export interface Participant {
	id: string
	displayName: string
	// The avatar they showed at the start (already validated at join and on
	// every change). Absent in runs from before it was recorded.
	avatar?: string
}

export interface StartedGame {
	runId: string
	seed: string
	stake: number | null
	options: unknown
	startedAt: number
	// When the first replay event of the game reached the server: the moment
	// the racers' run began (a draft and countdown come between startedAt and
	// it). Clients measure the race clock from it. Absent until that event.
	raceStartedAt?: number
	hostId: string
	players: Participant[]
}

// One player's replay events in arrival order, each the JSON text of its
// [t, opcode, args] tuple as encoded on arrival. Kept as text because object
// keys don't keep their order once match state has been through the Go
// runtime, and the log's hash (log_check.ts) is over the client's key order.
export interface PlayerLog {
	lines: string[]
	bytes: number
	truncated: boolean
}

// One Draft tile: a mod's own item, opaque to the server but for `key`, which
// names it, and `stake`, which the server rolls when the host asks it to.
export interface SetupItem {
	key: string
	stake?: number
	[field: string]: unknown
}

// One turn of a Draft: the actor slot (1-based, before the first-actor
// rotation) bans `count` tiles, or picks the one tile that is kept.
export interface DraftTurn {
	actor: number
	action: 'ban' | 'pick'
	count: number
}

export interface OpenDraft {
	kind: 'draft'
	id: string
	pool: SetupItem[]
	// Ban order: the tiles banned so far, oldest first.
	banned: string[]
	// The participants in actor order, and the index of the actor slot 1.
	order: string[]
	first: number
	schedule: DraftTurn[]
	turn: number
	// Bans the current turn still needs.
	remaining: number
	turnMs: number
	deadline: number
}

export interface OpenVote {
	kind: 'vote'
	id: string
	options: string[]
	voters: string[]
	// userId -> option. Hidden from clients until the vote closes.
	votes: { [userId: string]: string }
	deadline: number
}

export interface DraftResult {
	kind: 'draft'
	survivors: SetupItem[]
	banned: string[]
}

export interface VoteResult {
	kind: 'vote'
	option: string
	// option -> votes cast for it (every option present).
	counts: { [option: string]: number }
}

// Setup (ADR 0003): the steps a game runs before its run, one open at a time,
// and the results of the finished ones by step id.
export interface SetupState {
	open: OpenDraft | OpenVote | null
	results: { [id: string]: DraftResult | VoteResult }
}

// What clients see of an open step: a vote shows who voted, not for what.
// msLeft stands in for the deadline, so no client compares clocks.
export type OpenDraftView = Omit<OpenDraft, 'turnMs' | 'deadline'> & {
	actor: string | null
	msLeft: number
}
export type OpenVoteView = Omit<OpenVote, 'votes' | 'deadline'> & {
	voted: string[]
	msLeft: number
}

export interface SetupView {
	open: OpenDraftView | OpenVoteView | null
	results: { [id: string]: DraftResult | VoteResult }
}

// State the server owns for its authoritative actions (src/actions).
export interface GameState {
	// userId -> ready. Absent means not ready.
	ready: { [userId: string]: boolean }
	started: null | StartedGame
	// userId -> that participant's report of the placements.
	reports: { [userId: string]: Placement[] }
	// Report order, for breaking a disputed tie with no host report.
	reportOrder: string[]
	// When the result clock started: the first report, or the game dropping
	// under two remaining participants.
	settleFrom: number | null
	logs: { [userId: string]: PlayerLog }
	// Absent in match state from before Setup existed.
	setup?: SetupState
	// The started game's result is not known yet (mpapi_set_result_pending):
	// settle neither starts nor honours the result clock, and the run closes on
	// clear or when its last participant is gone. Absent means not pending.
	resultPending?: boolean
	// A player contested the started game (mpapi_contest). The run is stored as
	// 'contested' and rated by nobody until a moderator decides.
	contest?: Contest
	// The result was pending at some point in this run. Stays set after the
	// flag clears, so the settled run knows to tell players who left earlier.
	resultWasPending?: boolean
	// The latest complete Run save of each player (actions/run_save.ts), apart
	// from the log. Never sent to a client from here.
	runSaves?: { [userId: string]: RunSave }
	// A player's Run save still missing parts.
	runSavePending?: { [userId: string]: PendingRunSave }
}

// One player's Run save: the base64 text of the compressed save, whole, with
// the event position it was taken at and the hash of the log up to there.
export interface RunSave {
	id: string
	pos: number
	hash: string
	data: string
	at: number
}

export interface PendingRunSave {
	id: string
	count: number
	pos: number
	hash: string
	// Part index (as text) -> its data.
	parts: { [index: string]: string }
}

export interface Contest {
	// The contester, the player they contest, and when.
	by: string
	against: string
	at: number
}

// What clients see of GameState (logs stay on the server).
export interface GameView {
	ready: { [userId: string]: boolean }
	started: null | StartedGame
	reported: string[]
	// GameState.resultPending as a plain boolean: a host that takes over mid-run
	// reads it here, since only the old host knew it had asked for the hold.
	resultPending: boolean
	setup: SetupView
}

// agreed: every participant reported the same places. partial: whoever
// reported agreed, but not everyone reported. disputed: reports differ (the
// majority's -- or the host's -- is recorded). abandoned: no result.
// restarted: the host restarted the game. contested: a player contested the
// game; placements are what was reported before, and nobody is rated until a
// moderator decides.
export type RunStatus =
	| 'agreed'
	| 'partial'
	| 'disputed'
	| 'abandoned'
	| 'restarted'
	| 'contested'

// What a rated game did to one player: rating change and new rating are null
// while they are still in their placement games.
export interface RatingResult {
	delta: number | null
	newRating: number | null
	isPlacement: boolean
	// True on the game that ends the placement games, when newRating is first shown.
	justPlaced?: boolean
	gamesPlayed: number
}

// What a staff edit of a finished game did to one player's stored rating:
// the match's rating change before and after the edit (null: not rated, or
// still in the placement games), and the amounts added to the stored record.
export interface RatingChange {
	oldDelta: number | null
	newDelta: number | null
	rating: number
	wins: number
	losses: number
	gamesPlayed: number
}

// A stored replay log against the client's own closing hash (log_check.ts).
export type LogCheck = 'match' | 'mismatch' | 'unavailable'

// A finished game, as stored in RUNS_COLLECTION.
export interface RunRecord {
	runId: string
	code: string
	modId: string
	seed: string
	stake: number | null
	options: unknown
	startedAt: number
	endedAt: number
	status: RunStatus
	placements: Placement[]
	reports: { [userId: string]: Placement[] }
	// Who reported, first first (whose report a dispute is measured against).
	reportOrder?: string[]
	players: Participant[]
	// Set for a ranked lobby: the rating board (mode) the game counted on.
	rankedMode?: string
	// Set for a matchmade lobby: the queue it came from ('mode' or 'ranked:mode').
	gameMode?: string
	// 'public' for a matchmade or ranked lobby, else 'private' (the API's
	// lobby_runs.lobby_type).
	lobbyType?: 'public' | 'private'
	// Each rated player's result, once the game was rated.
	ratings?: { [userId: string]: RatingResult }
	// Players whose result is suspect (lobby/anticheat.ts); still rated.
	flags?: { [userId: string]: FlagReason }
	// Set when a moderator replaced the recorded result (review/result.ts):
	// the placements it had before, and when.
	overturned?: { at: number; previous: Placement[] }
	// Set when staff voided the game (rating/match_edit.ts); its ratings were
	// taken back and `ratings` removed.
	voided?: { at: number }
	// The last staff edit's effect on each player's stored rating, kept so a
	// repeated edit can answer with it (the API applies it to its own copy).
	ratingChanges?: { [userId: string]: RatingChange }
	// Set for a contested run: who contested whom, and when.
	contest?: Contest
	// What staff last told each player about this run (rating/match_edit.ts),
	// so deciding it again the same way tells them nothing new.
	told?: { [userId: string]: TellOutcome }
}

export type FlagReason = 'hash_mismatch' | 'elapsed_time_gate' | 'unverified_log'

// A game a player is still in, as run_active answers it: their own replay
// events so far, for a client that restarted mid-game to play catch-up.
export interface ReplayEvent {
	t: unknown
	opcode: unknown
	args: unknown
}

export interface ActiveRun {
	runId: string
	code: string
	modId: string
	events: ReplayEvent[]
	// A matchmade game's bar for coming back (lobby/match.ts); null for a
	// private lobby, which never gates.
	requiredStanding: RequiredStanding | null
	// The owner's latest complete Run save, for a rejoin from zero; null when
	// they have none, or when the log no longer matches it (runSaveSkipped says
	// why). Only the owner's own active run carries it.
	runSave: Omit<RunSave, 'at'> | null
	runSaveSkipped: 'hash_mismatch' | 'beyond_log' | null
	// The text the log hash is taken over: the log's events as they arrived,
	// joined into a JSON array. A client that resumes the log needs it to hash
	// the events it adds to the old ones.
	logText: string
}

// The other participants' logs so far, each as ActiveRun's events.
export interface ReplayTail {
	runId: string
	tails: { playerId: string; events: ReplayEvent[] }[]
}

// What a spectator joining mid-game has to start from: each participant's
// latest ante and hand, and the run to bootstrap (the API's
// getSpectatorSnapshot entries).
export interface SpectatorManifest {
	seed: string
	deck: string
	stake: number | null
	ruleset: string
	gamemode: string
	sleeve: string | null
	challenge: string | null
}

export interface SpectatorSnapshotEntry {
	playerId: string
	ante: string | null
	score: string | null
	handsRemaining: number | null
	manifest: SpectatorManifest | null
}

export interface SpectateSnapshot {
	code: string
	modId: string
	runId: string | null
	players: { playerId: string; displayName: string }[]
	snapshot: SpectatorSnapshotEntry[]
}

// A spectator's starting point for one player: the player's Run save, checked
// against the log as in ActiveRun, and the events after it (all of them when
// there is no save). `pos` is how many events the save covers.
export interface SpectateRun {
	playerId: string
	runSave: ActiveRun['runSave']
	runSaveSkipped: ActiveRun['runSaveSkipped']
	pos: number
	events: ReplayEvent[]
}

export interface SpectateEvent {
	playerId: string
	t: unknown
	opcode: unknown
	args: unknown
}

// GAME_ENDED event data.
export interface GameEnded {
	runId: string
	status: RunStatus
	placements: Placement[]
}

// The LobbyEvent wire strings MPAPI already handles (domain/lobby_event.lua).
export type LobbyEventType =
	| 'player_joined'
	| 'player_left'
	| 'player_kicked'
	| 'player_disconnected'
	| 'player_reconnected'
	// data: {catchingUp} -- see ClientOp.CATCHING_UP.
	| 'player_catching_up'
	| 'metadata_changed'
	| 'host_changed'
	| 'lobby_closed'
	| 'game_ended'

export interface LobbyEventMessage {
	type: LobbyEventType
	lobbyCode: string
	playerId?: string
	displayName?: string
	data?: unknown
}

export interface PlayerInfo {
	displayName: string
	preferredJoker: string | null
	mods: unknown
	// Worked out by the server (standing/current.ts) at join and kept current
	// as the player reports mods or gets a launcher verdict; never taken from
	// the client. Absent on a player seated before standings existed.
	standing?: AccountStanding
	// The X.Y.Z of the PvP mod in the player's stored mod report, worked out
	// by the server like the standing; '' or absent when none is reported.
	pvpVersion?: string
}

export interface SnapshotPlayer extends Omit<PlayerInfo, 'standing' | 'pvpVersion'> {
	id: string
	isAway: boolean
	// Replaying its own run after a crash (ClientOp.CATCHING_UP).
	catchingUp: boolean
	// null when the server never worked it out (see PlayerInfo).
	standing: AccountStanding | null
}

export interface Snapshot {
	code: string
	modId: string
	hostId: string
	maxPlayers: number
	type: 'private' | 'public' | 'ranked'
	metadata: { [key: string]: unknown }
	players: SnapshotPlayer[]
	ownState: unknown
	game: GameView
	// The home lobby's group queue, null when it isn't queueing.
	groupQueue: GroupQueueView | null
	// A matchmade Teams game: the two teams, each group kept whole.
	teamPlan: string[][] | null
	// How long the server holds a dropped seat before it forfeits it. The
	// client gives up reconnecting a little after this.
	graceSeconds: number
	// The server clock when this snapshot was made (ms), so a client can place
	// game.started.raceStartedAt on its own clock without trusting the two
	// clocks to agree.
	serverNow: number
}

// A private lobby queueing as one group (matchmaking/group): forming while
// the members gather in the queue's party, queued while its ticket is out,
// away while they play the public game it found. Idle is no group queue.
export type GroupPhase = 'forming' | 'queued' | 'away'

// Why a group queue ended or went back to forming.
export type GroupEndReason =
	| 'cancelled'
	| 'member_left'
	| 'member_left_party'
	| 'member_disconnected'
	| 'member_kicked'
	| 'lobby_closed'
	| 'ticket_removed'
	| 'match_refused'
	| 'member_refused'
	| 'away_over'
	| 'away_cap'
	| 'all_returned'

// What a home lobby's players see of its group queue.
export interface GroupQueueView {
	phase: GroupPhase
	partyId: string
	homeCode: string
	modId: string
	mode: string
	teams: boolean
	hostId: string
	memberIds: string[]
	// Queued: the party's ticket.
	ticket: string | null
	// Away: the public lobby they were matched into.
	matchId: string | null
	code: string | null
}

// ServerOp.GROUP_QUEUE. phase 'idle' ends the group queue (reason says why);
// a 'forming' with requeue: the matched game fell through and the leader
// queues the party again.
// Who a group queue ended over (member_refused), and why: their refusal's
// code (matchmaking/queue_refusal.ts) and the mods it names.
export interface RefusedMember {
	userId: string
	reason: QueueRefusalCode
	mods: string[]
}

export type GroupQueueMessage =
	| (GroupQueueView & { reason: GroupEndReason | null; requeue: boolean })
	| {
			phase: 'idle'
			partyId: string
			homeCode: string
			reason: GroupEndReason
			requeue: false
			// Set when reason is member_refused and the server knows who.
			refused?: RefusedMember
	  }

// A group a matchmade lobby was made with, and the home lobby to tell once
// its game is over.
export interface MatchedGroup {
	partyId: string
	homeCode: string
	memberIds: string[]
}

// matchSignal payloads (from RPCs) and replies.
export type LobbySignal =
	// 'yes', 'no', or (with forMatchId) 'away': a member of this home lobby's
	// group, away at that public lobby, which doesn't hold their seat here
	// against joining it.
	| { type: 'has_player'; userId: string; forMatchId?: string }
	| { type: 'leave'; userId: string }
	| { type: 'get_active'; userId: string }
	// chat_send's two steps around the (slow) moderation call, kept out of the
	// match loop: check the sender may talk and fetch the context, then post.
	| { type: 'chat_check'; userId: string }
	| { type: 'chat_post'; userId: string; text: string }
	// A profile change (player/rpc.ts) reaching the player's lobby.
	| { type: 'player_info'; userId: string; info: Partial<PlayerInfo> }
	// Admin actions and bans (moderation/enforce.ts, admin.ts).
	| { type: 'admin_remove'; userId: string; reason: string; onlyIfStarted?: boolean }
	| { type: 'admin_close' }
	| { type: 'admin_view' }
	// report_submit (moderation/report.ts): the evidence a report carries.
	| { type: 'report_evidence'; reporterId: string; reportedId: string }
	// The group queue (matchmaking/group): the home lobby is its source of
	// truth, so the RPCs and hooks ask it and tell it. group_members answers
	// GroupHomeFacts, group_status GroupQueueView or null.
	| { type: 'group_members' }
	| { type: 'group_status'; partyId: string }
	| { type: 'group_open'; userId: string; partyId: string; mode: string; teams: boolean }
	| { type: 'group_open_refused'; userId: string; partyId: string; refused: RefusedMember }
	| { type: 'group_queued'; partyId: string; ticket: string }
	| { type: 'group_unqueued'; partyId: string }
	| { type: 'group_requeue'; partyId: string }
	| { type: 'group_matched'; partyId: string; matchId: string; code: string }
	| { type: 'group_cancel'; partyId: string; reason: GroupEndReason; userId?: string; refused?: RefusedMember }
	// From the public lobby, once its first game is over (or it closed).
	| { type: 'away_over'; partyId: string; code: string }

// Storage object (per user) naming the lobby they are in, for reconnect after
// a game restart. Written and removed by the match only.
export const CURRENT_LOBBY_COLLECTION = 'lobby'
export const CURRENT_LOBBY_KEY = 'current'

// code -> {matchId, modId}, owned by the system user. Match labels can't be
// used to find a lobby by code: Nakama indexes them asynchronously, so a
// just-created lobby isn't findable for a moment. A write with version '*'
// only succeeds if the code is free, which makes reserving one atomic.
export const LOBBY_CODE_COLLECTION = 'lobby_codes'
export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

// A lobby instance's id: its match id without the node suffix. Codes are
// reused across lobbies; this is what reports and chat lines are keyed by.
export function lobbyIdOf(matchId: string): string {
	return matchId.split('.')[0]
}

// code -> Checkpoint (lobby/checkpoint.ts), owned by the system user: a lobby
// stopped by a server restart, until a player's return resumes it.
export const LOBBY_CHECKPOINT_COLLECTION = 'lobby_checkpoints'
// A checkpoint nobody came back for in this long is dropped.
export const CHECKPOINT_TTL_MS = 10 * 60 * 1000

// When a checkpoint ({at, expiresAt?}, as stored) is dropped unclaimed: its
// own expiresAt (a lobby whose group is away waits longer), else the TTL.
export function checkpointExpiry(stored: { [key: string]: unknown }): number {
	if (typeof stored.expiresAt === 'number') return stored.expiresAt
	return Number(stored.at) + CHECKPOINT_TTL_MS
}

// Finished games (src/lobby/storage.ts). Runs and logs are owned by the
// system user; each participant gets a pointer in MY_RUNS_COLLECTION.
export const RUNS_COLLECTION = 'match_runs'
export const LOGS_COLLECTION = 'match_logs'
export const MY_RUNS_COLLECTION = 'my_runs'

// A player's rating on one (mod, mode, season) board, owned by that player
// and written by the match only (src/rating).
export const RATINGS_COLLECTION = 'ratings'
