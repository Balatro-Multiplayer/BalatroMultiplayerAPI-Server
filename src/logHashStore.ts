import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Durable store for replay-log data (MP.RLOG).
 *
 * Two layers:
 *
 *  1. LIVE stream (`live_log_lines`) — while a game is in progress the mod
 *     streams its carbon (positional/replay) lines in here as they happen, so a
 *     crashed / abandoned game still leaves a partial record. Append-only.
 *
 *  2. FINAL package (`log_hashes`) — at game end the mod submits the complete
 *     carbon block plus the carbon/human hashes. When that lands we DELETE the
 *     game's live rows, so a finished game collapses to the single clean,
 *     hashed package (keyed by the server-authoritative seed + lobby/player).
 *
 * Everything here is best-effort and never throws into the relay's hot path.
 * To protect the relay from abuse, streamed input is rate/size limited — over a
 * limit the data is simply dropped (we'd rather lose logs than crash). All
 * limits are env-overridable. The DB path is configurable via LOG_HASH_DB_PATH
 * (point this at a mounted volume in Docker); it defaults to ./data/log_hashes.db.
 */

const envNum = (value: string | undefined, fallback: number): number => {
	const n = value ? Number(value) : Number.NaN;
	return Number.isFinite(n) && n > 0 ? n : fallback;
};

// --- Defensive limits (drop over these; never throw) -------------------------
/** Max size of a single streamed line; larger lines are skipped. */
const LIVE_MAX_LINE_BYTES = envNum(process.env.LIVE_MAX_LINE_BYTES, 8 * 1024);
/** Max lines accepted per stream message; extras in a batch are ignored. */
const LIVE_MAX_LINES_PER_MSG = envNum(process.env.LIVE_MAX_LINES_PER_MSG, 200);
/** Per-game ceilings; once hit, further live lines for that game are dropped. */
const LIVE_MAX_LINES_PER_GAME = envNum(process.env.LIVE_MAX_LINES_PER_GAME, 4000);
const LIVE_MAX_BYTES_PER_GAME = envNum(
	process.env.LIVE_MAX_BYTES_PER_GAME,
	1024 * 1024,
);
/** Per-connection rate cap: stream messages/sec; excess batches are dropped. */
const LIVE_RATE_MAX_PER_SEC = envNum(process.env.LIVE_RATE_MAX_PER_SEC, 25);
/** Sanity cap on the grouping key length. */
const LIVE_MAX_GAME_ID_BYTES = envNum(process.env.LIVE_MAX_GAME_ID_BYTES, 200);
/** Max size of the final carbon_log blob; larger ones store hashes only. */
const FINAL_MAX_CARBON_BYTES = envNum(
	process.env.FINAL_MAX_CARBON_BYTES,
	2 * 1024 * 1024,
);
/** Live rows older than this are pruned (covers games that never completed). */
const LIVE_TTL_MS = envNum(process.env.LIVE_TTL_MS, 6 * 60 * 60 * 1000);
const LIVE_PRUNE_INTERVAL_MS = envNum(
	process.env.LIVE_PRUNE_INTERVAL_MS,
	30 * 60 * 1000,
);

export interface LogHashRecord {
	/** Lobby code the game was played in (null if the lobby is already gone). */
	lobbyCode: string | null;
	/** Seed the server generated for the game (null for different-seeds games). */
	serverSeed: string | null;
	/** Seed the client reported in the submission. */
	claimedSeed: string | null;
	gameMode: string | null;
	username: string | null;
	modHash: string | null;
	isHost: boolean;
	carbonHash: string;
	humanHash: string;
	/** The full carbon (positional/replay) log block: manifest + action lines +
	 *  END + CHK. Lets us view/replay any game without the player sending a log.
	 *  Null if an older client submitted only hashes. */
	carbonLog: string | null;
}

export interface LiveLogInput {
	/** Connection id, used for per-connection rate limiting. */
	clientId: string;
	/** Per-game grouping key (client-generated); used to delete on completion. */
	gameId: string;
	lobbyCode: string | null;
	username: string | null;
	/** Raw carbon lines (e.g. "MP_RLOG: 5 buy 1 2"). */
	lines: string[];
}

const DB_PATH = process.env.LOG_HASH_DB_PATH ?? "./data/log_hashes.db";

let db: Database.Database | null = null;
let insertStmt: Database.Statement | null = null;
let liveInsertStmt: Database.Statement | null = null;
let deleteLiveStmt: Database.Statement | null = null;

// Per-connection rate window and per-game running totals (in-memory; reset on
// restart, which is fine — these only bound abuse, they aren't the source of
// truth).
const rateWindows = new Map<string, { windowStart: number; count: number }>();
const gameCounters = new Map<string, { lines: number; bytes: number }>();

const getDb = (): Database.Database => {
	if (db) return db;

	mkdirSync(dirname(DB_PATH), { recursive: true });
	db = new Database(DB_PATH);
	db.pragma("journal_mode = WAL");
	db.exec(`
		CREATE TABLE IF NOT EXISTS log_hashes (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			ts           INTEGER NOT NULL,
			lobby_code   TEXT,
			server_seed  TEXT,
			claimed_seed TEXT,
			game_mode    TEXT,
			username     TEXT,
			mod_hash     TEXT,
			is_host      INTEGER NOT NULL,
			carbon_hash  TEXT NOT NULL,
			human_hash   TEXT NOT NULL,
			carbon_log   TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_log_hashes_server_seed ON log_hashes (server_seed);
		CREATE INDEX IF NOT EXISTS idx_log_hashes_lobby_code  ON log_hashes (lobby_code);
		CREATE INDEX IF NOT EXISTS idx_log_hashes_username    ON log_hashes (username);

		CREATE TABLE IF NOT EXISTS live_log_lines (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			game_id    TEXT NOT NULL,
			ts         INTEGER NOT NULL,
			lobby_code TEXT,
			username   TEXT,
			line       TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_live_log_game_id ON live_log_lines (game_id);
		CREATE INDEX IF NOT EXISTS idx_live_log_ts      ON live_log_lines (ts);
	`);

	// Defensive migration: add carbon_log to a table created before it existed.
	const hasCarbonLog = db
		.prepare("SELECT 1 FROM pragma_table_info('log_hashes') WHERE name = 'carbon_log'")
		.get();
	if (!hasCarbonLog) {
		db.exec("ALTER TABLE log_hashes ADD COLUMN carbon_log TEXT");
	}

	return db;
};

/**
 * Persist a player's final, complete package (carbon block + hashes).
 * Returns true only when the full carbon_log was stored — i.e. when it's safe
 * to drop the game's live stream in favour of this package. Best-effort: never
 * throws into the relay's hot path.
 */
export const recordLogHashes = (record: LogHashRecord): boolean => {
	try {
		const database = getDb();
		if (!insertStmt) {
			insertStmt = database.prepare(`
				INSERT INTO log_hashes
					(ts, lobby_code, server_seed, claimed_seed, game_mode, username, mod_hash, is_host, carbon_hash, human_hash, carbon_log)
				VALUES
					(@ts, @lobbyCode, @serverSeed, @claimedSeed, @gameMode, @username, @modHash, @isHost, @carbonHash, @humanHash, @carbonLog)
			`);
		}

		let carbonLog = record.carbonLog;
		if (
			carbonLog != null &&
			Buffer.byteLength(carbonLog, "utf8") > FINAL_MAX_CARBON_BYTES
		) {
			console.warn(
				`carbon_log over ${FINAL_MAX_CARBON_BYTES} bytes; storing hashes only`,
			);
			carbonLog = null;
		}

		insertStmt.run({
			ts: Date.now(),
			lobbyCode: record.lobbyCode,
			serverSeed: record.serverSeed,
			claimedSeed: record.claimedSeed,
			gameMode: record.gameMode,
			username: record.username,
			modHash: record.modHash,
			isHost: record.isHost ? 1 : 0,
			carbonHash: record.carbonHash,
			humanHash: record.humanHash,
			carbonLog,
		});

		// Only signal "complete" when we actually stored the full package.
		return carbonLog != null;
	} catch (err) {
		console.error("Failed to record log hashes:", err);
		return false;
	}
};

/**
 * Append streamed carbon lines for an in-progress game. Rate/size limited:
 * anything over a limit is dropped, nothing throws. Best-effort.
 */
export const recordLiveLogLines = (input: LiveLogInput): void => {
	try {
		if (typeof input.gameId !== "string" || input.gameId.length === 0) return;
		if (input.gameId.length > LIVE_MAX_GAME_ID_BYTES) return;
		if (!Array.isArray(input.lines) || input.lines.length === 0) return;

		// Per-connection rate limit (messages/sec). Drop the whole batch if over.
		const now = Date.now();
		const win = rateWindows.get(input.clientId);
		if (!win || now - win.windowStart >= 1000) {
			rateWindows.set(input.clientId, { windowStart: now, count: 1 });
		} else {
			win.count++;
			if (win.count > LIVE_RATE_MAX_PER_SEC) return;
		}

		const counter = gameCounters.get(input.gameId) ?? { lines: 0, bytes: 0 };
		const toInsert: string[] = [];
		for (const raw of input.lines) {
			if (toInsert.length >= LIVE_MAX_LINES_PER_MSG) break;
			if (typeof raw !== "string") continue;
			const len = Buffer.byteLength(raw, "utf8");
			if (len === 0 || len > LIVE_MAX_LINE_BYTES) continue; // drop oversize/empty
			if (counter.lines >= LIVE_MAX_LINES_PER_GAME) break;
			if (counter.bytes + len > LIVE_MAX_BYTES_PER_GAME) break;
			counter.lines++;
			counter.bytes += len;
			toInsert.push(raw);
		}
		gameCounters.set(input.gameId, counter);
		if (toInsert.length === 0) return;

		const database = getDb();
		if (!liveInsertStmt) {
			liveInsertStmt = database.prepare(`
				INSERT INTO live_log_lines (game_id, ts, lobby_code, username, line)
				VALUES (@gameId, @ts, @lobbyCode, @username, @line)
			`);
		}
		const insertMany = database.transaction((lines: string[]) => {
			for (const line of lines) {
				liveInsertStmt?.run({
					gameId: input.gameId,
					ts: now,
					lobbyCode: input.lobbyCode,
					username: input.username,
					line,
				});
			}
		});
		insertMany(toInsert);
	} catch (err) {
		console.error("Failed to record live log lines:", err);
	}
};

/** Drop a game's live stream (called once the complete package is stored). */
export const deleteLiveLog = (gameId: string | null | undefined): void => {
	try {
		if (!gameId) return;
		const database = getDb();
		if (!deleteLiveStmt) {
			deleteLiveStmt = database.prepare(
				"DELETE FROM live_log_lines WHERE game_id = ?",
			);
		}
		deleteLiveStmt.run(gameId);
		gameCounters.delete(gameId);
	} catch (err) {
		console.error("Failed to delete live log:", err);
	}
};

// Periodically drop live rows from games that never completed, so partials
// don't accumulate. Only runs once the DB exists; unref'd so it never keeps the
// process alive.
const pruneLiveLog = (): void => {
	try {
		if (!db) return;
		const cutoff = Date.now() - LIVE_TTL_MS;
		const res = db
			.prepare("DELETE FROM live_log_lines WHERE ts < ?")
			.run(cutoff);
		if (res.changes > 0) {
			console.log(`live_log_lines: pruned ${res.changes} stale row(s)`);
		}
		// Forget rate windows that have gone cold so the map can't grow forever.
		const staleBefore = Date.now() - 60_000;
		for (const [key, w] of rateWindows) {
			if (w.windowStart < staleBefore) rateWindows.delete(key);
		}
	} catch (err) {
		console.error("live log prune failed:", err);
	}
};
const pruneTimer = setInterval(pruneLiveLog, LIVE_PRUNE_INTERVAL_MS);
pruneTimer.unref?.();
