import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Ban enforcement for the relay. There are two independent sources, both read
 * out of the same SQLite file on the /data volume:
 *
 *  1. ABUSE auto-bans (table `bans`) — written by this process when the abuse
 *     meter escalates. Keyed by two identifiers so a VPN hop doesn't dodge them:
 *       - "ip"   — the remote socket address.
 *       - "conn" — the client hardware id (serversideConnectionID), shipped
 *                  inside the `modHash` string.
 *     A ban with expires_ts = 0 is permanent; otherwise it lapses at that
 *     unix-ms instant.
 *
 *  2. CENTRAL hard bans (table `central_hard_bans`) — the curated, human-managed
 *     hard bans from the website (balatromp.com/admin/banned-users). This process
 *     only READS the table; mp-ban-watcher owns the writes (it syncs the
 *     `ban_type='hard'` rows from the central Postgres into it). Keyed by the
 *     lowercased serversideConnectionID. Soft bans never reach here — they stay
 *     warn-only via mp-ban-watcher.
 *
 * In-memory structures front every lookup so the hot path (one check per inbound
 * connection / username) never touches disk; the DB is the durable backing only.
 * `startBanAutoReload` re-reads both tables periodically so out-of-process writes
 * (mp-ban-watcher's central sync) take effect without a relay restart.
 */

export type BanKind = "ip" | "conn";

const DB_PATH = process.env.LOG_HASH_DB_PATH ?? "./data/log_hashes.db";

let db: Database.Database | null = null;

/** Abuse auto-bans: key = `${kind}:${id}` -> expiresTs (0 = permanent). */
const cache = new Map<string, number>();
/** Central hard bans: lowercased serversideConnectionIDs the website blocked. */
const centralHard = new Set<string>();
let loaded = false;

const cacheKey = (kind: BanKind, id: string) => `${kind}:${id}`;

const getDb = (): Database.Database => {
	if (db) return db;

	mkdirSync(dirname(DB_PATH), { recursive: true });
	db = new Database(DB_PATH);
	db.pragma("journal_mode = WAL");
	db.exec(`
		CREATE TABLE IF NOT EXISTS bans (
			kind       TEXT NOT NULL,
			id         TEXT NOT NULL,
			reason     TEXT,
			created_ts INTEGER NOT NULL,
			expires_ts INTEGER NOT NULL,
			PRIMARY KEY (kind, id)
		);
		-- Owned/written by mp-ban-watcher; this process only reads it. Created
		-- defensively so a relay booting before the first sync still reads clean.
		CREATE TABLE IF NOT EXISTS central_hard_bans (
			value_lower TEXT PRIMARY KEY,
			label       TEXT,
			updated_ts  INTEGER
		);
	`);

	return db;
};

/** (Re)load every ban from the DB into the in-memory cache. The repopulate is
 *  synchronous (better-sqlite3) so there's no window where a live ban reads as
 *  unbanned. Best-effort. */
const reload = (logCount = false): void => {
	try {
		const database = getDb();
		const rows = database
			.prepare("SELECT kind, id, expires_ts FROM bans")
			.all() as { kind: BanKind; id: string; expires_ts: number }[];
		cache.clear();
		for (const row of rows) cache.set(cacheKey(row.kind, row.id), row.expires_ts);

		const hardRows = database
			.prepare("SELECT value_lower FROM central_hard_bans")
			.all() as { value_lower: string }[];
		centralHard.clear();
		for (const row of hardRows) centralHard.add(row.value_lower.toLowerCase());

		loaded = true;
		if (logCount)
			console.log(
				`Loaded ${rows.length} abuse ban(s) + ${hardRows.length} central hard ban(s) from ${DB_PATH}`,
			);
	} catch (err) {
		console.error("Failed to load bans:", err);
		loaded = true;
	}
};

/** Load every ban into the in-memory cache. Best-effort; called lazily. */
const ensureLoaded = (): void => {
	if (loaded) return;
	reload(true);
};

let reloadTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Periodically re-read both ban tables so central hard bans synced in by
 * mp-ban-watcher (and any abuse bans) take effect without a relay restart.
 * Mirrors the cache-refresh model mp-ban-watcher itself uses for Postgres→Redis.
 */
export const startBanAutoReload = (
	intervalMs = Number(process.env.BAN_RELOAD_INTERVAL_MS) || 60_000,
): void => {
	if (reloadTimer) return;
	ensureLoaded();
	reloadTimer = setInterval(() => reload(), intervalMs);
	// Don't keep the process alive just for the reload timer.
	reloadTimer.unref?.();
	console.log(`Ban auto-reload every ${Math.round(intervalMs / 1000)}s`);
};

/** Drop a single (kind,id) from cache and DB. Best-effort. */
const drop = (kind: BanKind, id: string): void => {
	cache.delete(cacheKey(kind, id));
	try {
		getDb().prepare("DELETE FROM bans WHERE kind = ? AND id = ?").run(kind, id);
	} catch (err) {
		console.error("Failed to delete ban:", err);
	}
};

/** True if (kind,id) currently has a live ban. Lapsed bans are reaped on read. */
const isOneBanned = (kind: BanKind, id: string): boolean => {
	const expiresTs = cache.get(cacheKey(kind, id));
	if (expiresTs === undefined) return false;
	if (expiresTs !== 0 && expiresTs <= Date.now()) {
		// Expired — reap it so we don't keep checking a dead ban.
		drop(kind, id);
		return false;
	}
	return true;
};

/**
 * Is this connection banned? Checks, in order: a central hard ban on the
 * hardware id (website-managed), then the local abuse auto-bans by IP and by
 * hardware id. `connId` may be null early in a connection's life (before the
 * `username` action arrives), in which case only the IP is checked.
 */
export const isBanned = (ip: string | undefined, connId: string | null): boolean => {
	ensureLoaded();
	if (connId && centralHard.has(connId.toLowerCase())) return true;
	if (ip && isOneBanned("ip", ip)) return true;
	if (connId && isOneBanned("conn", connId)) return true;
	return false;
};

/**
 * Add (or extend) a ban. `ttlMs <= 0` means permanent. If a longer-lived ban
 * already exists for this id it is kept — escalation never shortens a ban.
 */
export const addBan = (
	kind: BanKind,
	id: string,
	ttlMs: number,
	reason: string,
): void => {
	ensureLoaded();
	const now = Date.now();
	const expiresTs = ttlMs <= 0 ? 0 : now + ttlMs;

	const existing = cache.get(cacheKey(kind, id));
	if (existing !== undefined) {
		const existingIsLonger =
			existing === 0 || (expiresTs !== 0 && existing >= expiresTs);
		if (existingIsLonger) return;
	}

	cache.set(cacheKey(kind, id), expiresTs);
	try {
		getDb()
			.prepare(
				`INSERT INTO bans (kind, id, reason, created_ts, expires_ts)
				 VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(kind, id) DO UPDATE SET
				   reason = excluded.reason,
				   created_ts = excluded.created_ts,
				   expires_ts = excluded.expires_ts`,
			)
			.run(kind, id, reason, now, expiresTs);
		console.log(
			`BAN ${kind}=${id} for ${ttlMs <= 0 ? "ever" : `${Math.round(ttlMs / 1000)}s`}: ${reason}`,
		);
	} catch (err) {
		console.error("Failed to persist ban:", err);
	}
};
