import { Router } from 'express'
import { findPunishmentRef } from '../../infrastructure/gateways/appeal.gateway.js'
import { listBans } from '../../infrastructure/gateways/ban.gateway.js'
import { getIntegrityEventsForPlayer } from '../../infrastructure/gateways/launcher-integrity.gateway.js'
import {
	listPlayerAppeals,
	listPlayerChat,
	listPlayerChatPage,
	listPlayerNotes,
	listPlayerQueueItems,
	namesOf,
} from '../../infrastructure/gateways/player-page.gateway.js'
import {
	liftWarningWithLog,
	saveNoteWithLog,
	saveWarningWithLog,
} from '../../infrastructure/gateways/player-page-write.gateway.js'
import {
	findPlayerById,
	findPlayerIdsByNakamaUserIds,
} from '../../infrastructure/gateways/player.gateway.js'
import { getRunsForPlayer } from '../../infrastructure/gateways/replay-log.gateway.js'
import { listWarnings } from '../../infrastructure/gateways/warning.gateway.js'
import {
	networkBansInNakama,
	notifyWarnedInNakama,
	playerNetworksInNakama,
} from '../../infrastructure/nakama/moderation-sync.js'
import { isLadder } from '../strikes/ladder.js'
import { judgeOnLadder, strikeSummaryOf } from '../strikes/strike.service.js'
import { parseReason } from '../../shared/staff-log/actions.js'
import { MAX_PAGE, queryInt } from '../../shared/utils/query-int.js'
import { AppError } from '../../shared/utils/errors.js'
import { redactPlayerFor, requireRole } from '../../shared/utils/staff-role.js'

// The staff player page: one read for every staff member (identity data left
// out), an identity read for admins only, and the two actions the page adds
// to the punishments that already have routes (players.route.ts): warnings
// and notes. A strikes section (the strike ladders) joins the page response.
const router = Router()

const MAX_WARNING_LENGTH = 500
const MATCHES_SHOWN = 50

function reasonOf(value: unknown): string {
	const checked = parseReason(value)
	if (!checked.ok) throw new AppError(checked.message, 400)
	return checked.reason
}

async function playerOr404(id: string) {
	const player = await findPlayerById(id)
	if (!player) throw new AppError('Player not found', 404)
	return player
}

// The player's whole chat, paged, grouped by lobby. A group carries the match
// its lobby ran, when it ran one.
router.get('/players/:id/chat', async (req, res, next) => {
	try {
		await requireRole(req, 'moderator')
		await playerOr404(req.params.id)
		const page = queryInt(req.query.page, 1, 1, MAX_PAGE)
		const limit = queryInt(req.query.limit, 100, 1, 200)
		const flaggedFirst = req.query.flaggedFirst === 'true'
		const { lines, total } = await listPlayerChatPage(req.params.id, {
			page,
			limit,
			flaggedFirst,
		})
		const groups: {
			key: string
			lobbyCode: string
			runId: string | null
			flagged: boolean
			lines: typeof lines
		}[] = []
		for (const line of lines) {
			const key = line.lobbyId ?? line.lobbyCode
			let group = groups[groups.length - 1]
			if (!group || group.key !== key) {
				group = { key, lobbyCode: line.lobbyCode, runId: null, flagged: false, lines: [] }
				groups.push(group)
			}
			group.lines.push(line)
			group.flagged ||= line.flagged
			group.runId ??= line.runId
		}
		res.json({ groups, total, page, limit, pages: Math.ceil(total / limit) })
	} catch (err) {
		next(err)
	}
})

router.get('/players/:id/page', async (req, res, next) => {
	try {
		const role = await requireRole(req, 'moderator')
		const player = await playerOr404(req.params.id)
		const id = req.params.id
		const [bans, warnings, matches, chat, queueItems, notes, integrityEvents, strikes, appeals] =
			await Promise.all([
				listBans(id),
				listWarnings(id),
				getRunsForPlayer(id, 1, MATCHES_SHOWN),
				listPlayerChat(id),
				listPlayerQueueItems(id),
				listPlayerNotes(id),
				getIntegrityEventsForPlayer(id),
				strikeSummaryOf(id),
				listPlayerAppeals(id),
			])
		const names = await namesOf([
			...bans.flatMap((b) => [b.issuedBy, b.liftedBy]),
			...warnings.map((w) => w.issuedBy),
			...notes.map((n) => n.authorId),
			...appeals.map((a) => a.decidedBy),
		])
		const nameOf = (actor: string | null) =>
			actor ? (names[actor] ?? null) : null
		res.json({
			player: redactPlayerFor(role, player),
			punishments: {
				bans: bans.map((b) => ({
					...b,
					issuedByName: nameOf(b.issuedBy),
					liftedByName: nameOf(b.liftedBy),
				})),
				warnings: warnings.map((w) => ({
					...w,
					issuedByName: nameOf(w.issuedBy),
				})),
			},
			matches: matches.runs,
			matchTotal: matches.total,
			chat,
			queueItems,
			notes: notes.map((n) => ({ ...n, authorName: nameOf(n.authorId) })),
			integrityEvents,
			strikes,
			appeals: appeals.map((a) => ({ ...a, decidedByName: nameOf(a.decidedBy) })),
		})
	} catch (err) {
		next(err)
	}
})

// Steam and Discord ids, the networks the account used, the network bans on
// them and the accounts those bans link. Admins only: a moderator is refused
// before any of it is read.
// The strikes that count on each ladder and the next recommended step, for the
// punish forms.
router.get('/players/:id/strikes', async (req, res, next) => {
	try {
		await requireRole(req, 'moderator')
		await playerOr404(req.params.id)
		res.json({ strikes: await strikeSummaryOf(req.params.id) })
	} catch (err) {
		next(err)
	}
})

router.get('/players/:id/identity', async (req, res, next) => {
	try {
		await requireRole(req, 'admin')
		const player = await playerOr404(req.params.id)
		const [networks, networkBans] = await Promise.all([
			playerNetworksInNakama(req.params.id),
			networkBansInNakama(req.params.id),
		])
		if (!networks.ok || !networkBans.ok)
			throw new AppError('Nakama is unavailable', 503)
		const others = networkBans.value.filter((b) => !b.own)
		const linkedIds = await findPlayerIdsByNakamaUserIds([
			...new Set(others.map((b) => b.bannedUserId)),
		])
		const linkedAccounts = await Promise.all(
			[...new Set(linkedIds.values())].map(async (playerId) => ({
				playerId,
				name: (await findPlayerById(playerId))?.steamName ?? null,
			})),
		)
		res.json({
			steamIdHash: player.steamIdHash,
			discordIdHash: player.discordIdHash,
			discordUsername: player.discordUsername,
			networks: { count: networks.value.length, hashes: networks.value },
			networkBans: networkBans.value,
			linkedAccounts,
		})
	} catch (err) {
		next(err)
	}
})

// An admin lifts a warning directly; a lifted warning stops counting as a strike.
router.delete('/players/:id/warnings/:warningId', async (req, res, next) => {
	try {
		const role = await requireRole(req, 'admin')
		const reason = reasonOf((req.body as { reason?: unknown } | undefined)?.reason)
		await playerOr404(req.params.id)
		const ref = await findPunishmentRef(req.params.warningId)
		if (!ref || ref.kind !== 'warning' || ref.playerId !== req.params.id)
			throw new AppError('Warning not found', 404)
		const lifted = await liftWarningWithLog(
			{ playerId: req.player!.playerId, role },
			req.params.id,
			req.params.warningId,
			reason,
		)
		if (!lifted) throw new AppError('That warning is already lifted', 409)
		res.json({ lifted: true })
	} catch (err) {
		next(err)
	}
})

router.post('/players/:id/notes', async (req, res, next) => {
	try {
		const role = await requireRole(req, 'moderator')
		// The note is the reason: it is what the staff log shows for the action.
		const note = reasonOf((req.body as { note?: unknown }).note)
		await playerOr404(req.params.id)
		const saved = await saveNoteWithLog(
			{ playerId: req.player!.playerId, role },
			req.params.id,
			note,
		)
		res.status(201).json({ note: saved })
	} catch (err) {
		next(err)
	}
})

router.post('/players/:id/warnings', async (req, res, next) => {
	try {
		const role = await requireRole(req, 'moderator')
		const body = req.body as {
			message?: unknown
			reason?: unknown
			ladder?: unknown
			deviationReason?: unknown
		}
		const message = typeof body.message === 'string' ? body.message.trim() : ''
		if (!message) throw new AppError('message is required', 400)
		if (message.length > MAX_WARNING_LENGTH)
			throw new AppError(
				`message is over ${MAX_WARNING_LENGTH} characters`,
				400,
			)
		const reason = reasonOf(body.reason)
		await playerOr404(req.params.id)
		if (body.ladder !== undefined && !isLadder(body.ladder))
			throw new AppError("ladder must be 'chat' or 'play'", 400)
		const ladder = isLadder(body.ladder) ? body.ladder : 'play'
		const now = new Date()
		const strike = await judgeOnLadder(
			req.params.id,
			ladder,
			'warning',
			typeof body.deviationReason === 'string' ? body.deviationReason : null,
			now,
		)
		const warning = await saveWarningWithLog(
			{ playerId: req.player!.playerId, role },
			{ playerId: req.params.id, message, reason, ladder, strike, now },
		)
		const delivered = await notifyWarnedInNakama(req.params.id, {
			message,
			itemType: 'player_page',
			warnedAt: Date.now(),
		}).catch(() => false)
		res.status(201).json({ warning, delivered })
	} catch (err) {
		next(err)
	}
})

export default router
