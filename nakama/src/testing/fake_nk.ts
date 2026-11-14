// Test double for the slice of nkruntime.Nakama the module uses: an in-memory
// storage with Nakama's version rules ('*' = must not exist, otherwise the
// versions must match), recorded notifications and http calls. Pass
// overrides for anything a test needs to script.
import type { ServerKind } from '../../../packages/types/src/server-kind'
import { settingsOf, type ServerSettings } from '../server_kind'

export interface FakeNk {
	objects: Map<string, { value: any; version: number }>
	notifications: { userId: string; subject: string; content: any; code: number; persistent: boolean }[]
	http: { url: string; method: string; headers: any; body: string }[]
	[key: string]: any
}

// Real Nakama (goja) throws a TypeError when a storage DELETE request has a
// `version` key that is not a string, `undefined` included: such a key must be
// left out. (Writes are not held to this: many older callers pass an optional
// `version: undefined` to storageWrite.)
function assertVersionKey(req: any): void {
	if ('version' in req && typeof req.version !== 'string')
		throw new TypeError('storage request: version must be a string, or the key left out')
}

export function fakeNk(overrides: { [key: string]: unknown } = {}): FakeNk {
	const objects = new Map<string, { value: any; version: number }>()
	let uuidCounter = 0
	const k = (c: string, u: string, key: string) => `${c}/${u}/${key}`
	const nk: FakeNk = {
		objects,
		notifications: [],
		http: [],
		storageRead: (reads: any[]) =>
			reads.flatMap((r) => {
				const o = objects.get(k(r.collection, r.userId, r.key))
				return o ? [{ ...r, value: o.value, version: String(o.version) }] : []
			}),
		storageWrite: (writes: any[]) => {
			for (const w of writes) {
				const e = objects.get(k(w.collection, w.userId, w.key))
				const ok = w.version === undefined || (w.version === '*' ? !e : e && String(e.version) === w.version)
				if (!ok) throw new Error('version check failed')
			}
			return writes.map((w) => {
				const key = k(w.collection, w.userId, w.key)
				const version = (objects.get(key)?.version ?? 0) + 1
				objects.set(key, { value: w.value, version })
				return { collection: w.collection, key: w.key, userId: w.userId, version: String(version) }
			})
		},
		// A delete that names a version needs the object to be at it, as in Nakama.
		storageDelete: (deletes: any[]) => {
			for (const d of deletes) assertVersionKey(d)
			for (const d of deletes) {
				const e = objects.get(k(d.collection, d.userId, d.key))
				if (d.version !== undefined && !(e && String(e.version) === d.version)) throw new Error('version check failed')
			}
			for (const d of deletes) objects.delete(k(d.collection, d.userId, d.key))
		},
		// userId null lists the collection across every owner, as Nakama does.
		// In key order, as Nakama lists one owner's objects.
		storageList: (userId: string | null, collection: string, limit?: number) => ({
			objects: [...objects.entries()]
				.map(([key, o]) => {
					const [c, u, ...rest] = key.split('/')
					return { collection: c, userId: u, key: rest.join('/'), value: o.value, version: String(o.version) }
				})
				.filter((o) => o.collection === collection && (userId === null || o.userId === userId))
				.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
				.slice(0, limit || undefined),
			cursor: '',
		}),
		uuidv4: () => `id-${++uuidCounter}`,
		notificationSend: (userId: string, subject: string, content: any, code: number, _sender: string, persistent: boolean) => {
			nk.notifications.push({ userId, subject, content, code, persistent })
		},
		httpRequest: (url: string, method: string, headers: any, body: string) => {
			nk.http.push({ url, method, headers, body })
			return { code: 200, headers: {}, body: '{}' }
		},
		...overrides,
	}
	return nk
}

export const fakeLogger = {
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined,
} as unknown as nkruntime.Logger

export const serverCtx = (env: { [key: string]: string } = {}) =>
	({ userId: '', username: '', matchId: '', env }) as nkruntime.Context

export const playerCtx = (userId: string, env: { [key: string]: string } = {}) =>
	({ userId, username: userId, matchId: '', env }) as nkruntime.Context

// The settings of a server of this kind (BMP_SERVER_KIND), for the functions
// that take them instead of a ctx.
export const settingsFor = (kind: ServerKind = 'official'): ServerSettings => settingsOf(serverCtx({ BMP_SERVER_KIND: kind }))
