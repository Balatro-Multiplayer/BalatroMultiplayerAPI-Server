import { Router } from 'express'
import { invalidateLatestCache } from '../../features/blog/blog.route.js'
import { sanitizeBlogHtml } from '../../features/blog/blog-sanitizer.js'
import type { BlogPostKind } from '../../infrastructure/db/schema.js'
import {
	createPost,
	deletePost,
	getPostById,
	listPosts,
	publishPost,
	unpublishPost,
	updatePost,
} from '../../infrastructure/gateways/blog.gateway.js'
import { AppError } from '../../shared/utils/errors.js'

// Admin surface for authoring patch notes/news - see features/blog/blog.route.ts
// for the public GET /latest these posts feed once published. Unlike
// launcher-releases.route.ts's requireAdmin, mutations here stay at the
// router-level webAdmin gate (admin OR moderator) - a bad blog post has
// nowhere near the blast radius of a bad release binary, so there's no
// reason to exclude moderators from authoring/publishing.
const router = Router()

const KINDS: readonly BlogPostKind[] = ['patch_notes', 'news']

router.get('/blog/posts', async (_req, res, next) => {
	try {
		res.json({ posts: await listPosts() })
	} catch (err) {
		next(err)
	}
})

router.get('/blog/posts/:id', async (req, res, next) => {
	try {
		const id = Number(req.params.id)
		if (!Number.isInteger(id)) throw new AppError('Invalid post id', 400)
		const post = await getPostById(id)
		if (!post) throw new AppError('Post not found', 404)
		res.json({ post })
	} catch (err) {
		next(err)
	}
})

router.post('/blog/posts', async (req, res, next) => {
	try {
		const kind = req.body.kind
		if (!KINDS.includes(kind)) throw new AppError('Invalid kind', 400)
		const title = typeof req.body.title === 'string' ? req.body.title.trim() : ''
		if (!title) throw new AppError('title is required', 400)
		const bodyHtml =
			typeof req.body.bodyHtml === 'string' ? req.body.bodyHtml : ''
		if (!bodyHtml.trim()) throw new AppError('bodyHtml is required', 400)

		const post = await createPost({
			kind,
			title,
			bodyHtml: sanitizeBlogHtml(bodyHtml),
			authorPlayerId: req.player!.playerId,
		})
		res.status(201).json({ post })
	} catch (err) {
		next(err)
	}
})

router.patch('/blog/posts/:id', async (req, res, next) => {
	try {
		const id = Number(req.params.id)
		if (!Number.isInteger(id)) throw new AppError('Invalid post id', 400)

		const input: Partial<{ title: string; bodyHtml: string }> = {}
		if (req.body.title !== undefined) {
			const title = typeof req.body.title === 'string' ? req.body.title.trim() : ''
			if (!title) throw new AppError('title cannot be empty', 400)
			input.title = title
		}
		if (req.body.bodyHtml !== undefined) {
			const bodyHtml =
				typeof req.body.bodyHtml === 'string' ? req.body.bodyHtml : ''
			if (!bodyHtml.trim()) throw new AppError('bodyHtml cannot be empty', 400)
			input.bodyHtml = sanitizeBlogHtml(bodyHtml)
		}

		const post = await updatePost(id, input)
		if (!post) throw new AppError('Post not found', 404)
		res.json({ post })
	} catch (err) {
		next(err)
	}
})

router.post('/blog/posts/:id/publish', async (req, res, next) => {
	try {
		const id = Number(req.params.id)
		if (!Number.isInteger(id)) throw new AppError('Invalid post id', 400)
		const post = await publishPost(id)
		if (!post) throw new AppError('Post not found', 404)
		invalidateLatestCache()
		res.json({ post })
	} catch (err) {
		next(err)
	}
})

router.post('/blog/posts/:id/unpublish', async (req, res, next) => {
	try {
		const id = Number(req.params.id)
		if (!Number.isInteger(id)) throw new AppError('Invalid post id', 400)
		const post = await unpublishPost(id)
		if (!post) throw new AppError('Post not found', 404)
		invalidateLatestCache()
		res.json({ post })
	} catch (err) {
		next(err)
	}
})

router.delete('/blog/posts/:id', async (req, res, next) => {
	try {
		const id = Number(req.params.id)
		if (!Number.isInteger(id)) throw new AppError('Invalid post id', 400)
		const post = await deletePost(id)
		if (!post) throw new AppError('Post not found', 404)
		invalidateLatestCache()
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

export default router
