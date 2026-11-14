// The group queue's effectful side (binding, hooks, RPCs and the matched
// hook) against a fake Nakama whose one home lobby answers its signals the
// way lobby/match.ts does: through answerGroupSignal, running the group's
// effects.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, writeConfig } from '../../config'
import { bindCode } from '../../lobby/codes'
import { answerGroupSignal, isGroupSignal } from '../../lobby/group_signals'
import { CURRENT_LOBBY_COLLECTION, CURRENT_LOBBY_KEY, type LobbySignal } from '../../lobby/protocol'
import type { PvpMode } from '../../lobby/pvp/state'
import { join, newLobby, type Lobby } from '../../lobby/state'
import { writeBans } from '../../moderation/bans'
import { NotifyCode } from '../../notify'
import { standingInputsUpdated } from '../../standing/changed'
import { clearModReport, writeModReport } from '../../standing/storage'
import { fakeLogger, fakeNk, playerCtx, settingsFor, type FakeNk } from '../../testing/fake_nk'
import { asEnvelope, asNakama } from '../../testing/casts'
import { reportVanilla } from '../../testing/reports'
import { beforeMatchmakerAdd, IN_GROUP_QUEUE } from '../gate'
import { matchmakerMatched, type MatchedEntry } from '../matched'
import { QUEUE_COLLECTION, clearMatched, recordKey } from '../queue'
import { deleteBinding, dissolveParty, groupOf, readBinding, signalHome, writeBinding } from './binding'
import {
	afterPartyMatchmakerAdd,
	beforePartyJoin,
	beforePartyLeave,
	beforePartyMatchmakerAdd,
	beforePartyMatchmakerRemove,
} from './hooks'
import { groupFits } from './matched'
import { rpcGroupQueueCancel, rpcGroupQueueOpen } from './rpc'

const PARTY = '0b0c4a9e-7f43-4f43-9f6e-1d2c3b4a5f60.bmp-local'
const HOME_MATCH = 'home-uuid.bmp-local'
// Reassigned by the PvP version tests (versionsIn) and restored after each.
let MOD = 'MultiplayerSPDRN'
const CASUAL = { modId: MOD, mode: 'standard', kind: 'casual' }
const CASUAL_QUERY = `+properties.modId:${MOD} +properties.mode:standard +properties.kind:casual`
const info = (name: string) => ({ displayName: name, preferredJoker: null, mods: null })

interface World {
	nk: FakeNk
	lobby: () => Lobby
	party: Set<string>
	created: { [key: string]: unknown }[]
	signals: LobbySignal[]
	// What the home lobby sent its players.
	sent: unknown[]
}

// A private lobby HOME12 with ids seated (the first hosting), and an empty
// party PARTY the RPCs and hooks look at through its stream. Every seated
// player, and the solo player s the matched tests seat with them, has a
// vanilla mod report, so their standing lets them queue.
function world(...ids: string[]): World {
	let lobby = newLobby({ code: 'HOME12', modId: MOD, maxPlayers: 4, creatorId: ids[0], now: 0, graceMs: 10_000 })
	for (const id of ids) lobby = join(lobby, id, `${id}-s`, info(id)).lobby
	const party = new Set<string>()
	const created: { [key: string]: unknown }[] = []
	const signals: LobbySignal[] = []
	const sent: unknown[] = []
	const nk: FakeNk = fakeNk({
		matchGet: (id: string) => (id === HOME_MATCH ? { matchId: id } : null),
		matchCreate: (_module: string, params: { [key: string]: unknown }) => {
			created.push(params)
			return 'pub-uuid.bmp-local'
		},
		matchSignal: (id: string, data: string) => {
			if (id !== HOME_MATCH) throw new Error('no such match')
			const signal = JSON.parse(data) as LobbySignal
			signals.push(signal)
			if (signal.type === 'has_player') return lobby.players.some((p) => p.id === signal.userId) ? 'yes' : 'no'
			if (!isGroupSignal(signal)) return ''
			const answer = answerGroupSignal(lobby, signal, { groupQueueEnabled: true }, Date.now())
			lobby = answer.step.lobby
			for (const effect of answer.step.out) {
				if (effect.kind === 'send') sent.push(effect.payload)
				if (effect.kind === 'groupBind')
					writeBinding(nk as any, { partyId: effect.partyId, homeCode: lobby.code, modId: lobby.modId, memberIds: effect.memberIds })
				if (effect.kind === 'groupUnbind') {
					deleteBinding(nk as any, effect.partyId, effect.memberIds)
					clearMatched(nk as any, lobby.modId, effect.gameMode, effect.memberIds)
					dissolveParty(nk as any, effect.partyId)
				}
				if (effect.kind === 'groupDissolve') dissolveParty(nk as any, effect.partyId)
			}
			return answer.reply
		},
		streamUserList: () => [...party].map((userId) => ({ userId, sessionId: `${userId}-s`, nodeId: 'bmp-local' })),
		streamUserKick: (presence: { userId: string }) => party.delete(presence.userId),
	})
	bindCode(nk as any, 'HOME12', HOME_MATCH, MOD)
	nk.storageWrite(
		ids.map((userId) => ({
			collection: CURRENT_LOBBY_COLLECTION,
			key: CURRENT_LOBBY_KEY,
			userId,
			value: { matchId: HOME_MATCH, code: 'HOME12', modId: MOD },
		})),
	)
	reportVanilla(nk, ...ids, 's')
	return { nk, lobby: () => lobby, party, created, signals, sent }
}

const rpc = (fn: typeof rpcGroupQueueOpen, w: World, userId: string, payload: unknown) =>
	JSON.parse(fn(playerCtx(userId), fakeLogger, w.nk as any, JSON.stringify(payload)))

const openFor = (w: World, by = 'a', extra: { [key: string]: unknown } = {}) =>
	rpc(rpcGroupQueueOpen, w, by, { partyId: PARTY, mode: 'standard', ...extra })

const ticketOf = (size: number, props: { [key: string]: unknown } = CASUAL, counts = { minCount: size + 1, maxCount: 4 }) => ({
	partyMatchmakerAdd: {
		partyId: PARTY,
		...counts,
		countMultiple: null,
		query: `+properties.modId:${props.modId} +properties.mode:${props.mode}`,
		stringProperties: props,
		numericProperties: { groupSize: size },
	},
})

function addTicket(w: World, by: string, ticket: string, size = 2) {
	const envelope = ticketOf(size)
	beforePartyMatchmakerAdd(playerCtx(by), fakeLogger, w.nk as any, envelope as any)
	afterPartyMatchmakerAdd(
		playerCtx(by),
		fakeLogger,
		w.nk as any,
		{ partyMatchmakerTicket: { partyId: PARTY, ticket } } as any,
		envelope as any,
	)
}

// a hosts, b joins the party, a queues the party's ticket.
function queuedWorld(): World {
	const w = world('a', 'b')
	w.party.add('a')
	openFor(w)
	w.party.add('b')
	addTicket(w, 'a', 'T1')
	return w
}

const entry = (userId: string, props: { [k: string]: string | number }, partyId?: string): MatchedEntry => ({
	presence: { userId },
	properties: props,
	partyId,
})
const grouped = (id: string) => entry(id, { ...CASUAL, groupSize: 2 }, PARTY)

describe('group_queue_open', () => {
	it('forms the lobby as the group and binds the party to it', () => {
		const w = world('a', 'b')
		w.party.add('a')
		const reply = openFor(w)
		expect(reply.groupQueue).toMatchObject({ phase: 'forming', partyId: PARTY, homeCode: 'HOME12', memberIds: ['a', 'b'] })
		expect(readBinding(w.nk as any, PARTY)).toEqual({ partyId: PARTY, homeCode: 'HOME12', modId: MOD, memberIds: ['a', 'b'] })
		expect(groupOf(w.nk as any, 'b')).toMatchObject({ phase: 'forming' })
	})
	it('answers a refusal as a value, naming who is in the way', () => {
		const w = world('a', 'b')
		w.party.add('a')
		expect(openFor(w, 'b').refused).toMatchObject({ code: 'not_host' })
		expect(openFor(w, 'a', { kind: 'ranked' }).refused).toMatchObject({ code: 'ranked' })
		w.party.add('stranger')
		expect(openFor(w).refused).toMatchObject({ code: 'party_mismatch', userId: 'stranger' })
		w.party.delete('stranger')
		writeBans(w.nk as any, 'b', { queue: { banId: 'x', expiresAt: null, reason: 'r' } })
		expect(openFor(w).refused).toMatchObject({ code: 'member_refused', userId: 'b' })
		expect(typeof openFor(w).refused.message).toBe('string')
		expect(readBinding(w.nk as any, PARTY)).toBeNull()
	})
	it('refuses a party another lobby is queueing with', () => {
		const w = world('a', 'b')
		w.party.add('a')
		writeBinding(w.nk as any, { partyId: PARTY, homeCode: 'ELSE12', modId: MOD, memberIds: ['x'] })
		expect(openFor(w).refused).toMatchObject({ code: 'party_in_use' })
	})
	it('refuses someone in no lobby', () => {
		const w = world('a', 'b')
		expect(openFor(w, 'nobody').refused).toMatchObject({ code: 'not_in_lobby' })
	})
})

describe('party hooks', () => {
	it('lets only members join the party, while forming', () => {
		const w = world('a', 'b')
		w.party.add('a')
		openFor(w)
		const join = (id: string) => beforePartyJoin(playerCtx(id), fakeLogger, w.nk as any, { partyJoin: { partyId: PARTY } } as any)
		expect(() => join('b')).not.toThrow()
		expect(() => join('stranger')).toThrow(/lobby/)
	})
	it('lets an unbound party do anything but queue', () => {
		const w = world('a', 'b')
		w.party.add('a')
		expect(() => beforePartyJoin(playerCtx('x'), fakeLogger, w.nk as any, { partyJoin: { partyId: PARTY } } as any)).not.toThrow()
		expect(() => beforePartyMatchmakerAdd(playerCtx('a'), fakeLogger, w.nk as any, ticketOf(1) as any)).toThrow()
	})
	it("refuses a ticket before the whole group is in the party, or that isn't the group's", () => {
		const w = world('a', 'b')
		w.party.add('a')
		openFor(w)
		expect(() => beforePartyMatchmakerAdd(playerCtx('a'), fakeLogger, w.nk as any, ticketOf(2) as any)).toThrow()
		w.party.add('b')
		const ranked = ticketOf(2, { ...CASUAL, kind: 'ranked' })
		expect(() => beforePartyMatchmakerAdd(playerCtx('a'), fakeLogger, w.nk as any, ranked as any)).toThrow()
		const selfMatch = ticketOf(2, CASUAL, { minCount: 2, maxCount: 2 })
		expect(() => beforePartyMatchmakerAdd(playerCtx('a'), fakeLogger, w.nk as any, selfMatch as any)).toThrow()
		expect(() => beforePartyMatchmakerAdd(playerCtx('b'), fakeLogger, w.nk as any, ticketOf(2) as any)).toThrow()
		expect(() => beforePartyMatchmakerAdd(playerCtx('a'), fakeLogger, w.nk as any, ticketOf(2) as any)).not.toThrow()
	})
	it('queues the group on its ticket, counting every member as queued', () => {
		const w = queuedWorld()
		expect(w.lobby().groupQueue).toMatchObject({ phase: 'queued', ticket: 'T1' })
		const key = recordKey(MOD, 'standard')
		const records = w.nk.storageRead(['a', 'b'].map((userId) => ({ collection: QUEUE_COLLECTION, key, userId })))
		expect(records.map((r: { value: { ticket: string } }) => r.value.ticket)).toEqual(['T1', 'T1'])
	})
	it("refuses a member's solo ticket while the group queues", () => {
		const w = queuedWorld()
		const solo = { matchmakerAdd: { query: CASUAL_QUERY, stringProperties: CASUAL } }
		expect(() => beforeMatchmakerAdd(playerCtx('b'), fakeLogger, w.nk as any, solo as any)).toThrow(IN_GROUP_QUEUE)
		reportVanilla(w.nk, 'z')
		expect(() => beforeMatchmakerAdd(playerCtx('z'), fakeLogger, w.nk as any, solo as any)).not.toThrow()
	})
	it('takes the ticket back to forming, and drops the records', () => {
		const w = queuedWorld()
		beforePartyMatchmakerRemove(
			playerCtx('a'),
			fakeLogger,
			w.nk as any,
			{ partyMatchmakerRemove: { partyId: PARTY, ticket: 'T1' } } as any,
		)
		expect(w.lobby().groupQueue).toMatchObject({ phase: 'forming' })
		expect(w.nk.storageList('a', QUEUE_COLLECTION).objects).toHaveLength(0)
	})
	it('ignores a ticket taken back before its add finished', () => {
		const w = world('a', 'b')
		w.party.add('a')
		openFor(w)
		w.party.add('b')
		const remove = { partyMatchmakerRemove: { partyId: PARTY, ticket: 'T9' } }
		beforePartyMatchmakerRemove(playerCtx('a'), fakeLogger, w.nk as any, remove as any)
		afterPartyMatchmakerAdd(
			playerCtx('a'),
			fakeLogger,
			w.nk as any,
			{ partyMatchmakerTicket: { partyId: PARTY, ticket: 'T9' } } as any,
			ticketOf(2) as any,
		)
		expect(w.lobby().groupQueue).toMatchObject({ phase: 'forming' })
	})
	it('ends the group queue when a member leaves the party, breaking up the party', () => {
		const w = queuedWorld()
		beforePartyLeave(playerCtx('b'), fakeLogger, w.nk as any, { partyLeave: { partyId: PARTY } } as any)
		expect(w.lobby().groupQueue).toBeNull()
		expect(readBinding(w.nk as any, PARTY)).toBeNull()
		expect(groupOf(w.nk as any, 'a')).toBeNull()
		expect(w.party.size).toBe(0)
		expect(w.nk.storageList('a', QUEUE_COLLECTION).objects).toHaveLength(0)
	})
	it('drops a binding whose lobby no longer has the group', () => {
		const w = world('a', 'b')
		writeBinding(w.nk as any, { partyId: PARTY, homeCode: 'HOME12', modId: MOD, memberIds: ['a', 'b'] })
		expect(groupOf(w.nk as any, 'a')).toBeNull()
		expect(readBinding(w.nk as any, PARTY)).toBeNull()
	})
})

describe('group_queue_cancel', () => {
	it('lets any member end the group queue', () => {
		const w = queuedWorld()
		expect(rpc(rpcGroupQueueCancel, w, 'b', {})).toEqual({ groupQueue: null })
		expect(w.lobby().groupQueue).toBeNull()
		expect(rpc(rpcGroupQueueCancel, w, 'b', {})).toEqual({ groupQueue: null })
	})
})

describe('matchmakerMatched with a group', () => {
	it('seats the group with a solo player, telling the home where it went', () => {
		const w = queuedWorld()
		const matchId = matchmakerMatched(playerCtx('a'), fakeLogger, w.nk as any, [
			grouped('a'),
			entry('s', { ...CASUAL, groupSize: 1 }),
			grouped('b'),
		])
		expect(matchId).toBe('pub-uuid.bmp-local')
		const params = w.created[0]
		expect(JSON.parse(String(params.groups))).toEqual([{ partyId: PARTY, homeCode: 'HOME12', memberIds: ['a', 'b'] }])
		expect(params.teamPlan).toBe('')
		expect(w.lobby().groupQueue).toMatchObject({ phase: 'away', matchId, code: params.code })
	})
	it("queues the group again when a solo player can't play", () => {
		const w = queuedWorld()
		writeBans(w.nk as any, 's', { queue: { banId: 'x', expiresAt: null, reason: 'r' } })
		expect(() =>
			matchmakerMatched(playerCtx('a'), fakeLogger, w.nk as any, [grouped('a'), grouped('b'), entry('s', CASUAL)]),
		).toThrow()
		expect(w.lobby().groupQueue).toMatchObject({ phase: 'forming' })
		expect(w.signals.some((s) => s.type === 'group_requeue')).toBe(true)
		expect(w.created).toHaveLength(0)
	})
	it("lets the group go when one of its members can't play", () => {
		const w = queuedWorld()
		writeBans(w.nk as any, 'b', { queue: { banId: 'x', expiresAt: null, reason: 'r' } })
		expect(() =>
			matchmakerMatched(playerCtx('a'), fakeLogger, w.nk as any, [grouped('a'), grouped('b'), entry('s', CASUAL)]),
		).toThrow()
		expect(w.lobby().groupQueue).toBeNull()
		expect(w.nk.notifications.map((n) => n.userId)).toEqual(['s'])
	})
	it('refuses a party ticket no lobby is queueing', () => {
		const w = world('a', 'b')
		expect(() =>
			matchmakerMatched(playerCtx('a'), fakeLogger, w.nk as any, [grouped('a'), grouped('b'), entry('s', CASUAL)]),
		).toThrow()
		expect(w.created).toHaveLength(0)
	})
	it('queues the group again when the match cannot even be planned', () => {
		const w = queuedWorld()
		expect(() =>
			matchmakerMatched(playerCtx('a'), fakeLogger, w.nk as any, [grouped('a'), grouped('b'), entry('s', { ...CASUAL, mode: 'x' })]),
		).toThrow()
		expect(w.lobby().groupQueue).toMatchObject({ phase: 'forming' })
	})
	it('is off with the switch', () => {
		const w = world('a', 'b')
		w.party.add('a')
		writeConfig(w.nk as any, { ...DEFAULT_CONFIG, groupQueueEnabled: false })
		expect(openFor(w).refused).toMatchObject({ code: 'disabled' })
	})
})

describe('groupFits', () => {
	const view = {
		phase: 'queued' as const,
		partyId: PARTY,
		homeCode: 'HOME12',
		modId: MOD,
		mode: 'standard',
		teams: false,
		hostId: 'a',
		memberIds: ['a', 'b'],
		ticket: 'T1',
		matchId: null,
		code: null,
	}
	const plan = { modId: MOD, gameMode: 'standard' }
	const group = { partyId: PARTY, memberIds: ['b', 'a'] }
	it('fits a queued group with the same members, mod and mode', () => {
		expect(groupFits(view, group, plan)).toBe(true)
	})
	it("doesn't fit otherwise", () => {
		expect(groupFits(null, group, plan)).toBe(false)
		expect(groupFits({ ...view, phase: 'forming' }, group, plan)).toBe(false)
		expect(groupFits(view, { partyId: PARTY, memberIds: ['a'] }, plan)).toBe(false)
		expect(groupFits(view, group, { modId: MOD, gameMode: 'other' })).toBe(false)
	})
})

describe('signalHome', () => {
	it('is null for a code with no live lobby', () => {
		const w = world('a')
		expect(signalHome(w.nk as any, 'NOPE12', { type: 'group_status', partyId: PARTY })).toBeNull()
	})
})

const PINNED = { ...DEFAULT_CONFIG, queueAllowedModIds: ['MultiplayerSPDRN'] }
const reportFor = (w: World, userId: string, mods: string[]) => writeModReport(w.nk as any, userId, { mods, reportedAt: 0 })

describe('the group queue and standings', () => {
	it("refuses to open while a member's mods aren't allowed, naming them and the mods", () => {
		const w = world('a', 'b')
		writeConfig(w.nk as any, PINNED)
		reportFor(w, 'a', ['MultiplayerSPDRN-0.1.1'])
		reportFor(w, 'b', ['MultiplayerSPDRN-0.1.1', 'Cryptid-0.5.3'])
		w.party.add('a')
		expect(openFor(w).refused).toEqual({
			code: 'member_refused',
			userId: 'b',
			reason: 'mods_not_allowed',
			mods: ['Cryptid'],
			detail: "These mods aren't allowed in matchmaking: Cryptid. Private lobbies allow any mods.",
			message: "A player in the lobby may not queue. These mods aren't allowed in matchmaking: Cryptid. Private lobbies allow any mods.",
		})
		writeModReport(w.nk as any, 'b', { mods: [], reportedAt: 0 })
		expect(openFor(w).groupQueue).toMatchObject({ phase: 'forming' })
	})
	it('says so for a member who never reported, and refuses them the party', () => {
		const w = world('a', 'b')
		writeConfig(w.nk as any, PINNED)
		clearModReport(w.nk as any, 'b')
		w.party.add('a')
		expect(openFor(w).refused).toMatchObject({ code: 'member_refused', userId: 'b', reason: 'mods_unreported', mods: [] })
		reportFor(w, 'b', [])
		openFor(w)
		clearModReport(w.nk as any, 'b')
		const join = () => beforePartyJoin(playerCtx('b'), fakeLogger, w.nk as any, { partyJoin: { partyId: PARTY } } as any)
		expect(join).toThrow(/reported its mods/)
	})
	it('cancels the whole group when a member is refused at matched time, saying who and why', () => {
		const w = queuedWorld()
		writeConfig(w.nk as any, PINNED)
		reportFor(w, 'a', [])
		reportFor(w, 's', [])
		reportFor(w, 'b', ['Cryptid-0.5.3'])
		expect(() =>
			matchmakerMatched(playerCtx('a'), fakeLogger, w.nk as any, [grouped('a'), grouped('b'), entry('s', CASUAL)]),
		).toThrow()
		expect(w.lobby().groupQueue).toBeNull()
		expect(w.lobby().code).toBe('HOME12')
		expect(w.sent[w.sent.length - 1]).toMatchObject({
			phase: 'idle',
			reason: 'member_refused',
			refused: { userId: 'b', reason: 'mods_not_allowed', mods: ['Cryptid'] },
		})
	})
	it('re-gates queued tickets when the allowlist changes: a group goes, a solo is told why', () => {
		const w = queuedWorld()
		w.party.add('s')
		// Cryptid and Talisman were allowed while b and s queued; the change drops them.
		writeConfig(w.nk as any, { ...PINNED, queueAllowedModIdsExtra: ['Cryptid', 'Talisman'] })
		reportFor(w, 'a', [])
		reportFor(w, 'b', ['Cryptid-0.5.3'])
		reportFor(w, 's', ['Talisman-2.0'])
		w.nk.storageWrite([
			{
				collection: QUEUE_COLLECTION,
				key: recordKey(MOD, 'standard'),
				userId: 's',
				value: { modId: MOD, gameMode: 'standard', ticket: 'TS', sessionId: 's-s', at: Date.now() },
			},
		])
		writeConfig(w.nk as any, PINNED)
		standingInputsUpdated(w.nk as any, settingsFor(), fakeLogger, Date.now())
		expect(w.lobby().groupQueue).toBeNull()
		expect(w.sent[w.sent.length - 1]).toMatchObject({ phase: 'idle', refused: { userId: 'b', mods: ['Cryptid'] } })
		const told = (code: number) => w.nk.notifications.filter((n) => n.code === code)
		expect(told(NotifyCode.QUEUE_CANCELLED).map((n) => [n.userId, n.content.code, n.content.mods])).toEqual([
			['s', 'mods_not_allowed', ['Talisman']],
		])
		expect(told(NotifyCode.QUEUE_CANCELLED)[0].content).toMatchObject({ modId: MOD, mode: 'standard', requeue: false })
		expect(w.nk.objects.has(`${QUEUE_COLLECTION}/s/${recordKey(MOD, 'standard')}`)).toBe(false)
		expect(
			told(NotifyCode.STANDING_CHANGED)
				.map((n) => [n.userId, n.content.standing])
				.sort(),
		).toEqual([
			['a', 'valid'],
			['b', 'none'],
			['s', 'none'],
		])
	})
})

describe('PvP versions in a group', () => {
	beforeEach(() => {
		MOD = 'MultiplayerPvP'
		CASUAL.modId = MOD
	})
	afterEach(() => {
		MOD = 'MultiplayerSPDRN'
		CASUAL.modId = MOD
	})
	const versions = (w: World, byId: { [userId: string]: string }) => {
		for (const id of Object.keys(byId)) reportFor(w, id, ['MultiplayerPvP-' + byId[id]])
	}

	it('refuses to queue a group whose members run different PvP versions, naming the older one', () => {
		const w = world('a', 'b')
		versions(w, { a: '1.1.0', b: '1.1.1' })
		w.party.add('a')
		expect(openFor(w).refused).toMatchObject({ code: 'member_refused', userId: 'a', reason: 'version_mismatch', mods: [] })
		versions(w, { a: '1.1.1' })
		expect(openFor(w).groupQueue).toMatchObject({ phase: 'forming' })
	})
	it('cancels a matched group over the member off the common version, saying who and why', () => {
		// The group queues on one version (the floor); b falls back before the match.
		const w = world('a', 'b')
		versions(w, { a: '1.1.1', b: '1.1.1' })
		w.party.add('a')
		openFor(w)
		w.party.add('b')
		addTicket(w, 'a', 'T1')
		versions(w, { a: '1.1.1', b: '1.1.0', s: '1.1.1' })
		expect(() =>
			matchmakerMatched(playerCtx('a'), fakeLogger, w.nk as any, [grouped('a'), grouped('b'), entry('s', CASUAL)]),
		).toThrow()
		expect(w.sent[w.sent.length - 1]).toMatchObject({
			phase: 'idle',
			reason: 'member_refused',
			refused: { userId: 'b', reason: 'version_mismatch', mods: [] },
		})
	})
})

describe('the kill switch for a group queue', () => {
	beforeEach(() => {
		MOD = 'MultiplayerPvP'
		CASUAL.modId = MOD
	})
	afterEach(() => {
		MOD = 'MultiplayerSPDRN'
		CASUAL.modId = MOD
	})
	const PVP_TICKET = { modId: 'MultiplayerPvP', mode: 'pvp_royale', kind: 'casual' }
	const queueing = (disabledPvpModes: PvpMode[]) => {
		const w = world('a', 'b')
		for (const id of ['a', 'b']) reportFor(w, id, ['MultiplayerPvP-1.1.0'])
		writeConfig(asNakama(w.nk), { ...DEFAULT_CONFIG, disabledPvpModes })
		w.party.add('a')
		openFor(w, 'a', { mode: 'pvp_royale' })
		w.party.add('b')
		return w
	}
	const refusalOf = (w: World): string | null => {
		try {
			beforePartyMatchmakerAdd(playerCtx('a'), fakeLogger, asNakama(w.nk), asEnvelope(ticketOf(2, PVP_TICKET)))
			return null
		} catch (e) {
			return (e as { message: string }).message
		}
	}

	it('refuses the ticket of a disabled mode with the bare code', () => {
		expect(refusalOf(queueing(['royale']))).toBe('mode_disabled')
	})
	it('lets the ticket of a mode that is still on through', () => {
		expect(refusalOf(queueing(['teams']))).toBeNull()
		expect(refusalOf(queueing([]))).toBeNull()
	})
})
