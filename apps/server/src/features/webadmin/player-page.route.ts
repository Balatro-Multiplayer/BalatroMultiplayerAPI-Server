import { Router } from 'express'
import { db } from '../../infrastructure/db/index.js'
import { listBans } from '../../infrastructure/gateways/ban.gateway.js'
import { getIntegrityEventsForPlayer } from '../../infrastructure/gateways/launcher-integrity.gateway.js'
import {
	insertPlayerNote,
	listPlayerChat,
	listPlayerNotes,
	listPlayerQueueItems,
	namesOf,
} from '../../infrastructure/gateways/player-page.gateway.js'
import {
	findPlayerById,
	findPlayerIdsByNakamaUserIds,
} from '../../infrastructure/gateways/player.gateway.js'
import { getRunsForPlayer } from '../../infrastructure/gateways/replay-log.gateway.js'
import { recordStaffAction } from '../../infrastructure/gateways/staff-log.gateway.js'
import {
	insertWarning,
	listWarnings,
} from '../../infrastructure/gateways/warning.gateway.js'
import {
	networkBansInNakama,
	notifyWarnedInNakama,
	playerNetworksInNakama,
} from '../../infrastructure/nakama/moderation-sync.js'
import { parseReason } from '../../shared/staff-log/actions.js'
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

router.get('/players/:id/page', async (req, res, next) => {
	try {
		const role = await requireRole(req, 'moderator')
		const player = await playerOr404(req.params.id)
		const id = req.params.id
		const [bans, warnings, matches, chat, queueItems, notes, integrityEvents] =
			await Promise.all([
				listBans(id),
				listWarnings(id),
				getRunsForPlayer(id, 1, MATCHES_SHOWN),
				listPlayerChat(id),
				listPlayerQueueItems(id),
				listPlayerNotes(id),
				getIntegrityEventsForPlayer(id),
			])
		const names = await namesOf([
			...bans.flatMap((b) => [b.issuedBy, b.liftedBy]),
			...warnings.map((w) => w.issuedBy),
			...notes.map((n) => n.authorId),
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
		})
	} catch (err) {
		next(err)
	}
})

// Steam and Discord ids, the networks the account used, the network bans on
// them and the accounts those bans link. Admins only: a moderator is refused
// before any of it is read.
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

router.post('/players/:id/notes', async (req, res, next) => {
	try {
		const role = await requireRole(req, 'moderator')
		// The note is the reason: it is what the staff log shows for the action.
		const note = reasonOf((req.body as { note?: unknown }).note)
		await playerOr404(req.params.id)
		const staffId = req.player!.playerId
		const saved = await db.transaction(async (tx) => {
			const row = await insertPlayerNote(tx, {
				playerId: req.params.id,
				note,
				authorId: staffId,
			})
			await recordStaffAction(tx, {
				staff: { playerId: staffId, role },
				action: 'note',
				targetPlayerId: req.params.id,
				reason: note,
			})
			return row
		})
		res.status(201).json({ note: saved })
	} catch (err) {
		next(err)
	}
})

router.post('/players/:id/warnings', async (req, res, next) => {
	try {
		const role = await requireRole(req, 'moderator')
		const body = req.body as { message?: unknown; reason?: unknown }
		const message = typeof body.message === 'string' ? body.message.trim() : ''
		if (!message) throw new AppError('message is required', 400)
		if (message.length > MAX_WARNING_LENGTH)
			throw new AppError(
				`message is over ${MAX_WARNING_LENGTH} characters`,
				400,
			)
		const reason = reasonOf(body.reason)
		await playerOr404(req.params.id)
		const staffId = req.player!.playerId
		const warning = await db.transaction(async (tx) => {
			const row = await insertWarning(tx, {
				playerId: req.params.id,
				itemId: null,
				message,
				issuedBy: `${role}:${staffId}`,
			})
			await recordStaffAction(tx, {
				staff: { playerId: staffId, role },
				action: 'warn',
				targetPlayerId: req.params.id,
				reason,
				detail: { warningId: row.id, message },
			})
			return row
		})
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
