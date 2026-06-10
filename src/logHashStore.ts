import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Durable store for end-of-game replay-log fingerprints (MP.RLOG).
 *
 * Each player submits a carbon (positional/replay) hash and a human hash at the
 * end of a game. We persist them keyed by the server-authoritative seed plus the
 * lobby/player context so a presented log can later be re-hashed and compared
 * without a line-by-line diff. We also keep the client-claimed seed; a mismatch
 * with the server seed is itself a tamper signal.
 *
 * The DB path is configurable via LOG_HASH_DB_PATH (point this at a mounted
 * volume in Docker); it defaults to ./data/log_hashes.db.
 */

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
}

const DB_PATH = process.env.LOG_HASH_DB_PATH ?? "./data/log_hashes.db";

let db: Database.Database | null = null;
let insertStmt: Database.Statement | null = null;

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
			human_hash   TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_log_hashes_server_seed ON log_hashes (server_seed);
		CREATE INDEX IF NOT EXISTS idx_log_hashes_lobby_code  ON log_hashes (lobby_code);
		CREATE INDEX IF NOT EXISTS idx_log_hashes_username    ON log_hashes (username);
	`);

	return db;
};

/** Persist one player's submitted hashes. Best-effort: never throws into the
 *  relay's hot path — failures are logged and swallowed. */
export const recordLogHashes = (record: LogHashRecord): void => {
	try {
		const database = getDb();
		if (!insertStmt) {
			insertStmt = database.prepare(`
				INSERT INTO log_hashes
					(ts, lobby_code, server_seed, claimed_seed, game_mode, username, mod_hash, is_host, carbon_hash, human_hash)
				VALUES
					(@ts, @lobbyCode, @serverSeed, @claimedSeed, @gameMode, @username, @modHash, @isHost, @carbonHash, @humanHash)
			`);
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
		});
	} catch (err) {
		console.error("Failed to record log hashes:", err);
	}
};
