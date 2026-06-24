import { Router } from 'express'
import { AppError } from '../../shared/utils/errors.js'
import {
	addBranch,
	addRelease,
	deleteBranch,
	deleteRelease,
	listBranches,
	listReleasesAdmin,
	updateRelease,
	type ReleaseInput,
	type SortBy,
} from '../../infrastructure/gateways/releases.gateway.js'

function parseReleaseBody(body: unknown): ReleaseInput {
	const b = (body ?? {}) as Record<string, unknown>
	if (typeof b.name !== 'string' || !b.name.trim()) throw new AppError('name is required', 400)
	if (typeof b.version !== 'string' || !b.version.trim()) throw new AppError('version is required', 400)
	if (typeof b.url !== 'string' || !b.url.trim()) throw new AppError('url is required', 400)
	return {
		name: b.name.trim(),
		version: b.version.trim(),
		url: b.url.trim(),
		description: typeof b.description === 'string' ? b.description : null,
		smods_version: typeof b.smods_version === 'string' && b.smods_version.trim() ? b.smods_version.trim() : 'latest',
		lovely_version: typeof b.lovely_version === 'string' && b.lovely_version.trim() ? b.lovely_version.trim() : 'latest',
		branchId: Number.isInteger(b.branchId) ? (b.branchId as number) : 1,
	}
}

const RELEASE_SORTS: readonly SortBy[] = ['createdAt', 'name', 'version', 'branchName']

const router = Router()

router.get('/releases', async (req, res, next) => {
	try {
		const page = Math.max(1, Number(req.query.page ?? 1))
		const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 50)))
		const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined
		const sortByRaw = typeof req.query.sortBy === 'string' ? req.query.sortBy : 'createdAt'
		const sortBy = (RELEASE_SORTS as readonly string[]).includes(sortByRaw) ? (sortByRaw as SortBy) : 'createdAt'
		const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc'
		res.json(await listReleasesAdmin({ page, pageSize, search: search || undefined, sortBy, sortOrder }))
	} catch (err) {
		next(err)
	}
})

router.post('/releases', async (req, res, next) => {
	try {
		const release = await addRelease(parseReleaseBody(req.body))
		console.log(`[webadmin] ${req.player!.playerId} added release ${release!.id} (${release!.name})`)
		res.status(201).json({ release })
	} catch (err) {
		next(err)
	}
})

router.put('/releases/:id', async (req, res, next) => {
	try {
		const id = Number(req.params.id)
		if (!Number.isInteger(id)) throw new AppError('Invalid release id', 400)
		const release = await updateRelease(id, parseReleaseBody(req.body))
		if (!release) throw new AppError('Release not found', 404)
		res.json({ release })
	} catch (err) {
		next(err)
	}
})

router.delete('/releases/:id', async (req, res, next) => {
	try {
		const id = Number(req.params.id)
		if (!Number.isInteger(id)) throw new AppError('Invalid release id', 400)
		await deleteRelease(id)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

router.get('/branches', async (_req, res, next) => {
	try {
		res.json({ branches: await listBranches() })
	} catch (err) {
		next(err)
	}
})

router.post('/branches', async (req, res, next) => {
	try {
		const { name } = req.body as { name?: unknown }
		if (typeof name !== 'string' || !name.trim()) throw new AppError('name is required', 400)
		const branch = await addBranch(name.trim())
		if (!branch) throw new AppError('Branch already exists', 409)
		res.status(201).json({ branch })
	} catch (err) {
		next(err)
	}
})

router.delete('/branches/:id', async (req, res, next) => {
	try {
		const id = Number(req.params.id)
		if (!Number.isInteger(id)) throw new AppError('Invalid branch id', 400)
		const result = await deleteBranch(id)
		if (!result.ok) throw new AppError('Branch has releases and cannot be deleted', 409)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

export default router
