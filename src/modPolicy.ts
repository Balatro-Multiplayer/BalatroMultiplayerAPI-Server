// Server-authoritative mod policy: which mods are banned vs approved in ranked.
//
// The client receives this via the `setModPolicy` action on connect (and on live
// admin updates) and colours each opponent mod red (banned) / green (approved) /
// white (unknown). Server-driven so staff update it without a mod release.
//
// NOTE on category bans: the staff policy bans whole categories (mods that add
// content, raise game speed above 4x, or preview the top card / "misprint tech").
// The server cannot infer those categories from a mod id alone, so category
// members must be curated into the `banned` list here by id. Unknown mods stay
// white on purpose — we never auto-ban something we can't classify.
//
// Value semantics (mirror the client's MP.UTILS.get_banned_mods):
//   true            -> matches every version
//   "1.2.3"         -> matches only that version
//   ["1.0", "1.1"]  -> matches this set of versions
//
// Keys are SMODS mod ids; the client compares them case- and
// punctuation-insensitively, so display-name-derived keys still match.

import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export type ModRule = boolean | string | string[]
export type ModMap = Record<string, ModRule>
export type ModPolicy = { banned: ModMap; approved: ModMap }

// Minimal baseline used only if mod_policy.json is missing/invalid. The full
// curated lists live in mod_policy.json (generated from staff lists).
const DEFAULT_POLICY: ModPolicy = {
	banned: { Cryptid: true, Saturn: true, Talisman: true, Showman: true, Aura: true },
	approved: { Lovely: true, Steamodded: true, Multiplayer: true, Preview: true },
}

const scriptDir = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url))
const POLICY_PATH = resolve(scriptDir, '..', 'mod_policy.json')

function loadInitial(): ModPolicy {
	if (existsSync(POLICY_PATH)) {
		try {
			const parsed = JSON.parse(readFileSync(POLICY_PATH, 'utf-8'))
			const banned = parsed?.banned && typeof parsed.banned === 'object' ? parsed.banned : {}
			const approved = parsed?.approved && typeof parsed.approved === 'object' ? parsed.approved : {}
			console.log(
				`Loaded mod policy from ${POLICY_PATH}: ${Object.keys(banned).length} banned, ${Object.keys(approved).length} approved`,
			)
			return { banned, approved }
		} catch (e) {
			console.warn(`Failed to parse mod_policy.json (${(e as Error).message}), using defaults`)
		}
	}
	return { banned: { ...DEFAULT_POLICY.banned }, approved: { ...DEFAULT_POLICY.approved } }
}

let policy: ModPolicy = loadInitial()

export const getModPolicy = (): ModPolicy => policy

export const setModPolicy = (next: Partial<ModPolicy>): ModPolicy => {
	policy = {
		banned: next.banned && typeof next.banned === 'object' ? next.banned : policy.banned,
		approved: next.approved && typeof next.approved === 'object' ? next.approved : policy.approved,
	}
	return policy
}

// Remote source of truth: the BalatroMP website. The server polls it and
// refreshes the in-memory policy without a restart; mod_policy.json remains the
// boot/offline fallback if the site is unreachable. Override BALATROMP_BASE_URL
// to http://localhost:3000 for local dev; defaults to production.
const BALATROMP_BASE_URL = (process.env.BALATROMP_BASE_URL || 'https://balatromp.com').replace(/\/+$/, '')
export const MOD_POLICY_URL = `${BALATROMP_BASE_URL}/api/mod-policy`
export const MOD_POLICY_REFRESH_MS = Math.max(5000, Number(process.env.MOD_POLICY_REFRESH_MS) || 300000)
const MOD_POLICY_TOKEN = process.env.MOD_POLICY_TOKEN || null

// One normalized record from the remote endpoint's `mods` array.
type RemoteModRecord = {
	modId: string
	status: 'banned' | 'approved'
	versions?: string[] | null
}

// Fetches the normalized record array { mods: [...] } from the remote endpoint and
// builds the internal { banned, approved } lookup maps. Returns null on any failure
// (network, bad status, malformed body) so the caller keeps the cache.
export async function fetchRemotePolicy(url: string): Promise<ModPolicy | null> {
	try {
		const res = await fetch(url, {
			headers: MOD_POLICY_TOKEN ? { Authorization: `Bearer ${MOD_POLICY_TOKEN}` } : {},
			signal: AbortSignal.timeout(10000),
		})
		if (!res.ok) {
			console.warn(`mod policy fetch ${url} -> HTTP ${res.status}`)
			return null
		}
		const parsed = (await res.json()) as { mods?: RemoteModRecord[] }
		if (!Array.isArray(parsed?.mods)) {
			console.warn('mod policy fetch: response has no mods array')
			return null
		}
		const banned: ModMap = {}
		const approved: ModMap = {}
		for (const m of parsed.mods) {
			if (!m || typeof m.modId !== 'string') continue
			const rule: ModRule = Array.isArray(m.versions) && m.versions.length > 0 ? m.versions : true
			;(m.status === 'banned' ? banned : approved)[m.modId] = rule
		}
		return { banned, approved }
	} catch (e) {
		console.warn(`mod policy fetch failed: ${(e as Error).message}`)
		return null
	}
}
