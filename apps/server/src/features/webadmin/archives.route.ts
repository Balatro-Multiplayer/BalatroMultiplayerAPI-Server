import { Router } from 'express'
import {
	contentTypeFor,
	listArchives,
	readBundleMessages,
	readBundleMeta,
	readMentions,
	readThreadIndex,
	resolveBundleDir,
	resolveBundleFile,
} from './archives.service.js'

const router = Router()

router.get('/archives', (req, res) => {
	const search =
		typeof req.query.search === 'string' ? req.query.search.trim() : undefined
	res.json({ archives: listArchives(search) })
})

// :bundlePath is base64url-encoded by the client (see resolveBundleDir's own
// comment for why) -- a nested thread path like "guild/channel_x/threads/
// msg_y" still arrives as one opaque route segment either way.
router.get('/archives/:bundlePath', (req, res, next) => {
	try {
		const bundleDir = resolveBundleDir(req.params.bundlePath)
		const page = Math.max(1, Number(req.query.page ?? 1))
		const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200)))
		const search =
			typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : ''

		const meta = readBundleMeta(bundleDir)
		let messages = readBundleMessages(bundleDir)
		if (search) {
			messages = messages.filter((m) =>
				m.content.toLowerCase().includes(search),
			)
		}

		const total = messages.length
		const offset = (page - 1) * limit
		const page_ = messages.slice(offset, offset + limit)

		res.json({
			meta,
			messages: page_,
			total,
			page,
			limit,
			pages: Math.ceil(total / limit) || 1,
			mentions: readMentions(bundleDir),
			threads: readThreadIndex(bundleDir),
		})
	} catch (err) {
		next(err)
	}
})

router.get('/archives/:bundlePath/attachments/:filename', (req, res, next) => {
	try {
		const bundleDir = resolveBundleDir(req.params.bundlePath)
		const filePath = resolveBundleFile(
			bundleDir,
			'attachments',
			req.params.filename,
		)
		res.setHeader('Content-Type', contentTypeFor(req.params.filename))
		res.sendFile(filePath)
	} catch (err) {
		next(err)
	}
})

router.get('/archives/:bundlePath/emojis/:filename', (req, res, next) => {
	try {
		const bundleDir = resolveBundleDir(req.params.bundlePath)
		const filePath = resolveBundleFile(bundleDir, 'emojis', req.params.filename)
		res.setHeader('Content-Type', contentTypeFor(req.params.filename))
		res.sendFile(filePath)
	} catch (err) {
		next(err)
	}
})

export default router
