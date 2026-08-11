import { addBan } from "./banStore.js";

/**
 * Per-connection abuse metering for the TCP relay.
 *
 * The relay frames messages on '\n' and JSON.parses each one. Without limits a
 * client can (a) stream gigabytes with no newline so the reassembly buffer grows
 * until the host OOMs, or (b) flood small messages / huge single messages to burn
 * CPU. This module bounds all three.
 *
 * Enforcement is deliberately tiered and drop-first so a real player who blips a
 * limit is never kicked:
 *   - Tier 1 (always): drop a single over-sized message, or a message that breaks
 *     the per-connection rate budget. The connection stays up.
 *   - Tier 2: a reassembly-buffer overflow (a no-newline flood — no legitimate
 *     client ever does this) or too many Tier-1 strikes in a short window ->
 *     disconnect.
 *   - Tier 3: repeated Tier-2 events for the same IP / hardware id -> a temporary
 *     ban (escalating in length on repeat offence).
 *
 * Buffer-overflow protection is unconditional because it is the actual OOM fix and
 * is unambiguous. The rate-heuristic disconnects and all bans are gated by
 * ABUSE_ENFORCE so the thresholds can be validated against live traffic in a
 * shadow period (set ABUSE_ENFORCE=false) before they bite.
 */

const num = (env: string, fallback: number): number => {
	const raw = process.env[env];
	if (raw === undefined) return fallback;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : fallback;
};

const KB = 1024;

export const ABUSE_CONFIG = {
	/** Largest single (newline-framed) message we will JSON.parse. The real worst
	 *  case is submitLogHashes carrying a full carbon log (tens of KB). */
	MAX_MESSAGE_BYTES: num("ABUSE_MAX_MESSAGE_BYTES", 512 * KB),
	/** Largest the incomplete-message reassembly buffer may grow before we treat
	 *  it as a no-newline flood and disconnect. */
	MAX_BUFFER_BYTES: num("ABUSE_MAX_BUFFER_BYTES", 1024 * KB),

	/** Sustained inbound byte budget and its burst allowance (token bucket). */
	BYTE_RATE_PER_SEC: num("ABUSE_BYTE_RATE_PER_SEC", 256 * KB),
	BYTE_BURST: num("ABUSE_BYTE_BURST", 2048 * KB),

	/** Sustained message budget and its burst allowance (token bucket). */
	MSG_RATE_PER_SEC: num("ABUSE_MSG_RATE_PER_SEC", 30),
	MSG_BURST: num("ABUSE_MSG_BURST", 100),

	/** Tier-1 strikes within STRIKE_WINDOW_MS before a Tier-2 disconnect. */
	STRIKE_LIMIT: num("ABUSE_STRIKE_LIMIT", 25),
	STRIKE_WINDOW_MS: num("ABUSE_STRIKE_WINDOW_MS", 10_000),

	/** Tier-2 disconnects (per IP/conn) within DISCONNECT_WINDOW_MS before a ban. */
	DISCONNECTS_BEFORE_BAN: num("ABUSE_DISCONNECTS_BEFORE_BAN", 3),
	DISCONNECT_WINDOW_MS: num("ABUSE_DISCONNECT_WINDOW_MS", 5 * 60_000),

	/** Base temp-ban length; each prior ban for the same id multiplies it. */
	BASE_BAN_MS: num("ABUSE_BASE_BAN_MS", 60 * 60_000),
	MAX_BAN_MS: num("ABUSE_MAX_BAN_MS", 24 * 60 * 60_000),

	/** Min gap between throttle notices sent back to one connection. */
	NOTICE_INTERVAL_MS: num("ABUSE_NOTICE_INTERVAL_MS", 5_000),

	/** When false, Tier-2 (rate) and Tier-3 (ban) are logged but not applied.
	 *  Tier-1 message drops and buffer-overflow disconnects always apply. */
	ENFORCE: process.env.ABUSE_ENFORCE !== "false",
} as const;

/** A leaky/token bucket. `take` returns false when the requested amount exceeds
 *  what's available (i.e. the caller is over budget). */
class TokenBucket {
	private tokens: number;
	private last: number;
	constructor(
		private readonly ratePerSec: number,
		private readonly capacity: number,
	) {
		this.tokens = capacity;
		this.last = Date.now();
	}
	take(amount: number): boolean {
		const now = Date.now();
		this.tokens = Math.min(
			this.capacity,
			this.tokens + ((now - this.last) / 1000) * this.ratePerSec,
		);
		this.last = now;
		if (this.tokens >= amount) {
			this.tokens -= amount;
			return true;
		}
		// Still consume what we can so a sustained overload stays pinned at empty.
		this.tokens = 0;
		return false;
	}
}

export type Verdict =
	| { kind: "ok" }
	| { kind: "drop"; reason: string; notify: boolean }
	| { kind: "disconnect"; reason: string };

/** Tracks Tier-2 disconnects per identity so repeat offenders earn a ban. */
const disconnectLog = new Map<string, number[]>();
/** How many bans an identity has already received -> escalating ban length. */
const banCount = new Map<string, number>();

const noteDisconnectAndMaybeBan = (
	kind: "ip" | "conn",
	id: string,
	reason: string,
): void => {
	const key = `${kind}:${id}`;
	const now = Date.now();
	const within = (disconnectLog.get(key) ?? []).filter(
		(t) => now - t < ABUSE_CONFIG.DISCONNECT_WINDOW_MS,
	);
	within.push(now);
	disconnectLog.set(key, within);

	if (within.length < ABUSE_CONFIG.DISCONNECTS_BEFORE_BAN) return;
	if (!ABUSE_CONFIG.ENFORCE) {
		console.warn(`[abuse:shadow] would ban ${key} (${reason})`);
		return;
	}

	const priorBans = banCount.get(key) ?? 0;
	const ttl = Math.min(
		ABUSE_CONFIG.BASE_BAN_MS * 2 ** priorBans,
		ABUSE_CONFIG.MAX_BAN_MS,
	);
	banCount.set(key, priorBans + 1);
	disconnectLog.delete(key);
	addBan(kind, id, ttl, `auto: ${reason}`);
};

export class ConnectionMeter {
	private readonly byteBucket = new TokenBucket(
		ABUSE_CONFIG.BYTE_RATE_PER_SEC,
		ABUSE_CONFIG.BYTE_BURST,
	);
	private readonly msgBucket = new TokenBucket(
		ABUSE_CONFIG.MSG_RATE_PER_SEC,
		ABUSE_CONFIG.MSG_BURST,
	);
	private strikes: number[] = [];
	private lastNoticeAt = 0;

	/** ip is for logging + ban keying; connId is filled in once the username
	 *  action lands (it may be null before then). */
	constructor(
		private readonly ip: string,
		public connId: string | null = null,
	) {}

	/** Account raw bytes that just arrived on the socket (before reassembly). */
	noteBytes(n: number): void {
		this.byteBucket.take(n);
	}

	/** The reassembly buffer can't be completed and has grown past the cap: a
	 *  no-newline flood. Always a disconnect (this is the OOM guard). */
	bufferOverflow(): { kind: "disconnect"; reason: string } {
		this.recordDisconnect("buffer-overflow flood");
		return { kind: "disconnect", reason: "message too large" };
	}

	/** Decide what to do with one complete, newline-framed message. */
	inspectMessage(byteLen: number): Verdict {
		if (byteLen > ABUSE_CONFIG.MAX_MESSAGE_BYTES) {
			return this.strike("oversized message");
		}
		// Charge the byte budget for the framed message too; the raw-chunk
		// accounting is coarse because TCP coalesces.
		const bytesOk = this.byteBucket.take(byteLen);
		const msgOk = this.msgBucket.take(1);
		if (!bytesOk || !msgOk) {
			return this.strike(bytesOk ? "message rate" : "byte rate");
		}
		return { kind: "ok" };
	}

	/** Register a Tier-1 strike and escalate to Tier-2 if too many land fast. */
	private strike(reason: string): Verdict {
		const now = Date.now();
		this.strikes = this.strikes.filter(
			(t) => now - t < ABUSE_CONFIG.STRIKE_WINDOW_MS,
		);
		this.strikes.push(now);

		if (this.strikes.length >= ABUSE_CONFIG.STRIKE_LIMIT) {
			if (ABUSE_CONFIG.ENFORCE) {
				this.recordDisconnect(`strike flood (${reason})`);
				return { kind: "disconnect", reason: "too many invalid messages" };
			}
			console.warn(
				`[abuse:shadow] would disconnect ${this.ip} (strike flood: ${reason})`,
			);
		}

		const notify = now - this.lastNoticeAt > ABUSE_CONFIG.NOTICE_INTERVAL_MS;
		if (notify) this.lastNoticeAt = now;
		return { kind: "drop", reason, notify };
	}

	/** Record a Tier-2 disconnect against both identities and maybe ban. */
	private recordDisconnect(reason: string): void {
		console.warn(
			`[abuse] disconnecting ip=${this.ip} conn=${this.connId ?? "?"}: ${reason}`,
		);
		noteDisconnectAndMaybeBan("ip", this.ip, reason);
		if (this.connId) noteDisconnectAndMaybeBan("conn", this.connId, reason);
	}
}

/** Pull serversideConnectionID out of the (full) modHash string the mod sends. */
export const parseConnectionId = (modHash: string | undefined): string | null => {
	if (!modHash) return null;
	const match = modHash.match(/serversideConnectionID=([^;]+)/);
	return match ? match[1] : null;
};
