import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Durable store for abuse bans.
 *
 * Bans are keyed by two independent identifiers so a banned player can't simply
 * hop onto a VPN to dodge it:
 *   - "ip"   — the remote socket address.
 *   - "conn" — the client hardware id (serversideConnectionID), which the mod
 *              derives from the machine and ships inside the `modHash` string.
 *
 * A ban with expires_ts = 0 is permanent; otherwise it lapses at that unix-ms
 * instant. The DB shares LOG_HASH_DB_PATH with the replay-log store so it lives
 * on the same mounted /data volume and survives container redeploys.
 *
 * An in-memory cache fronts every lookup so the hot path (one check per inbound
 * connection / username) never touches disk. The DB is the durable backing only.
 */

export type BanKind = "ip" | "conn";

export interface BanRow {
	kind: BanKind;
	id: string;
	reason: string | null;
	createdTs: number;
	/** Unix-ms expiry; 0 means permanent. */
	expiresTs: number;
}

const DB_PATH = process.env.LOG_HASH_DB_PATH ?? "./data/log_hashes.db";

let db: Database.Database | null = null;

/** key = `${kind}:${id}` -> expiresTs (0 = permanent). */
const cache = new Map<string, number>();
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
	`);

	return db;
};

/** (Re)load every ban from the DB into the in-memory cache. The repopulate is
 *  synchronous (better-sqlite3) so there's no window where a live ban reads as
 *  unbanned. Best-effort. */
const reload = (logCount = false): void => {
	try {
		const rows = getDb()
			.prepare("SELECT kind, id, expires_ts FROM bans")
			.all() as { kind: BanKind; id: string; expires_ts: number }[];
		cache.clear();
		for (const row of rows) cache.set(cacheKey(row.kind, row.id), row.expires_ts);
		loaded = true;
		if (logCount) console.log(`Loaded ${rows.length} ban(s) from ${DB_PATH}`);
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
 * Periodically re-read the ban table so bans added out-of-process (e.g. by the
 * admin_ban.py script writing straight to the SQLite file) take effect without a
 * relay restart. Mirrors the cache-refresh model the mp-ban-watcher already uses.
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
 * Is this connection banned by either its IP or its hardware id? `connId` may be
 * null early in a connection's life (before the `username` action arrives), in
 * which case only the IP is checked.
 */
export const isBanned = (ip: string | undefined, connId: string | null): boolean => {
	ensureLoaded();
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

/** Lift a ban. Returns true if one was present. */
export const removeBan = (kind: BanKind, id: string): boolean => {
	ensureLoaded();
	const had = cache.has(cacheKey(kind, id));
	drop(kind, id);
	return had;
};

/** All live bans (lapsed ones reaped), newest expiry first-ish. For admin use. */
export const listBans = (): BanRow[] => {
	ensureLoaded();
	try {
		const rows = getDb()
			.prepare(
				"SELECT kind, id, reason, created_ts AS createdTs, expires_ts AS expiresTs FROM bans",
			)
			.all() as BanRow[];
		const now = Date.now();
		return rows.filter((r) => {
			if (r.expiresTs !== 0 && r.expiresTs <= now) {
				drop(r.kind, r.id);
				return false;
			}
			return true;
		});
	} catch (err) {
		console.error("Failed to list bans:", err);
		return [];
	}
};
