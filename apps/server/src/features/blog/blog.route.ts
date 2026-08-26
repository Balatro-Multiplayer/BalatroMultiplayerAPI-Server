import { Router } from 'express'
import type { BlogPost } from '../../infrastructure/gateways/blog.gateway.js'
import { getLatestPublishedByAllKinds } from '../../infrastructure/gateways/blog.gateway.js'

// Public, launcher-facing endpoint -- no auth, same precedent as
// features/launcher/launcher.route.ts's GET /latest ("the launcher polls
// it"). Every running launcher hits this on startup and every ~10 minutes
// (see BlogManager in the new-launcher repo), so a short in-process cache
// (see cachedLatest below) is worth it even though this is only ever a
// two-row read - it's invalidated eagerly on every admin mutation (see
// invalidateLatestCache, called from features/webadmin/blog.route.ts), so
// admin-facing staleness stays at zero while still flattening a burst of
// launchers all starting around the same time (e.g. right after a patch).
const router = Router()

const CACHE_TTL_MS = 60_000

let cached: { patchNotes: BlogPost | null; news: BlogPost | null; expiresAt: number } | null =
	null

export function invalidateLatestCache() {
	cached = null
}

async function cachedLatest() {
	if (cached && cached.expiresAt > Date.now()) {
		return cached
	}
	const latest = await getLatestPublishedByAllKinds()
	cached = { ...latest, expiresAt: Date.now() + CACHE_TTL_MS }
	return cached
}

function toPublicShape(post: BlogPost | null) {
	if (!post) return null
	return {
		id: post.id,
		title: post.title,
		bodyHtml: post.bodyHtml,
		publishedAt: post.publishedAt,
	}
}

// null per category (not a whole-endpoint 404) is the correct "nothing
// published yet" signal here - unlike launcher.route.ts's /latest, this
// endpoint has two independent categories that can each be empty on their
// own, which a single 404 couldn't express.
router.get('/latest', async (_req, res, next) => {
	try {
		const { patchNotes, news } = await cachedLatest()
		res.json({
			patchNotes: toPublicShape(patchNotes),
			news: toPublicShape(news),
		})
	} catch (err) {
		next(err)
	}
})

export default router
