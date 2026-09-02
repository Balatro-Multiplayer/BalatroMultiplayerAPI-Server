import fs from 'node:fs'
import path from 'node:path'
import { env } from '../../env.js'
import { AppError } from '../../shared/utils/errors.js'

// Mirrors the JSON shape written verbatim by the external Discord archiver
// bot (discord-channel-archiver) -- this service only reads bundles that
// were manually copied onto the server's filesystem under ARCHIVE_DIR, it
// never writes or ingests them itself.

export interface ArchivedAttachment {
	id: string
	name: string
	url: string
	size: number
	contentType: string | null
	localPath: string | null
	downloadError: string | null
}

export interface ArchivedReaction {
	emoji: string
	emojiId: string | null
	animated: boolean
	count: number
}

export interface ArchivedMessage {
	id: string
	createdAt: string
	editedAt: string | null
	authorId: string
	authorUsername: string
	authorDisplayName: string | null
	authorBot: boolean
	content: string
	type: number
	pinned: boolean
	replyToMessageId: string | null
	hasThread: boolean
	attachments: ArchivedAttachment[]
	embeds: unknown[]
	reactions: ArchivedReaction[]
	stickers: Array<{ id: string; name: string }>
}

export interface ArchiveMeta {
	guildId: string
	channelId: string
	channelName: string
	exportedAt: string
	order: string
	threadOnlyChannel?: boolean
}

export interface ThreadSummary {
	id: string
	name: string
	dirName: string
	messageCount: number
	attachmentsSucceeded: number
	archived: boolean | null
	completed: boolean
}

export interface MentionLookups {
	users: Record<string, { username: string; displayName: string | null }>
	channels: Record<string, string>
	roles: Record<string, string>
}

export interface ArchiveListEntry {
	bundlePath: string
	guildId: string
	channelId: string
	channelName: string
	exportedAt: string
	messageCount: number
	attachmentCount: number
	threadCount: number
	threadOnlyChannel: boolean
}

const ARCHIVE_ROOT = path.resolve(env.ARCHIVE_DIR)

// Prevents path traversal via a bundlePath/filename supplied by the client
// (e.g. "../../../etc/passwd") -- path.resolve collapses ".." segments, so
// checking the result is still under ARCHIVE_ROOT catches every traversal
// attempt regardless of how it's encoded, not just a literal "..".
function resolveWithinArchiveRoot(relPath: string): string {
	if (!relPath || relPath.includes('\0')) {
		throw new AppError('Invalid archive path', 400)
	}
	const resolved = path.resolve(ARCHIVE_ROOT, relPath)
	if (
		resolved !== ARCHIVE_ROOT &&
		!resolved.startsWith(ARCHIVE_ROOT + path.sep)
	) {
		throw new AppError('Invalid archive path', 400)
	}
	return resolved
}

// The client base64url-encodes the whole relative bundlePath (see
// apps/web's encodeBundlePathForApi) rather than percent-encoding its
// slashes -- /api/proxy/[...path]/route.ts (a shared, generic proxy used by
// every feature, not something this route should special-case) decodes %2F
// back into a real "/" and splits it into extra segments before forwarding
// upstream, which broke this specific route with a 404 despite the actual
// archive existing. base64url has no "/" or "%" for that layer to mangle.
function decodeBundlePathParam(encoded: string): string {
	try {
		const decoded = Buffer.from(encoded, 'base64url').toString('utf8')
		if (!decoded) throw new Error('empty')
		return decoded
	} catch {
		throw new AppError('Invalid archive path', 400)
	}
}

export function resolveBundleDir(encodedBundlePath: string): string {
	const resolved = resolveWithinArchiveRoot(
		decodeBundlePathParam(encodedBundlePath),
	)
	if (!fs.existsSync(path.join(resolved, 'messages.jsonl'))) {
		throw new AppError('Archive not found', 404)
	}
	return resolved
}

// filename comes from its own route segment (never containing the bundle's
// slashes), but is re-validated here too in case a client sends an encoded
// "%2F.." trying to escape the attachments/emojis subdirectory.
export function resolveBundleFile(
	bundleDir: string,
	subdir: 'attachments' | 'emojis',
	filename: string,
): string {
	if (
		!filename ||
		filename.includes('/') ||
		filename.includes('\\') ||
		filename.includes('..')
	) {
		throw new AppError('Invalid filename', 400)
	}
	const resolved = path.join(bundleDir, subdir, filename)
	const subdirRoot = path.join(bundleDir, subdir)
	if (!resolved.startsWith(subdirRoot + path.sep)) {
		throw new AppError('Invalid filename', 400)
	}
	if (!fs.existsSync(resolved)) {
		throw new AppError('File not found', 404)
	}
	return resolved
}

const CONTENT_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.bmp': 'image/bmp',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.mov': 'video/quicktime',
}

export function contentTypeFor(filename: string): string {
	return (
		CONTENT_TYPES[path.extname(filename).toLowerCase()] ??
		'application/octet-stream'
	)
}

function readJsonlLines(messagesPath: string): string[] {
	return fs.readFileSync(messagesPath, 'utf8').trim().split('\n')
}

export function readBundleMeta(bundleDir: string): ArchiveMeta {
	const lines = readJsonlLines(path.join(bundleDir, 'messages.jsonl'))
	return JSON.parse(lines[0])
}

// messages.jsonl is written reverse-chronological (most recent page first,
// see the archiver's own comment on that) -- reversed here so callers get
// natural chronological order, matching the archiver's own static viewer.
export function readBundleMessages(bundleDir: string): ArchivedMessage[] {
	const lines = readJsonlLines(path.join(bundleDir, 'messages.jsonl'))
	const messages = lines
		.slice(1)
		.map((line) => JSON.parse(line) as ArchivedMessage)
	messages.reverse()
	return messages
}

export function readThreadIndex(bundleDir: string): ThreadSummary[] {
	const indexPath = path.join(bundleDir, 'threads', 'index.json')
	if (!fs.existsSync(indexPath)) return []
	try {
		return JSON.parse(fs.readFileSync(indexPath, 'utf8'))
	} catch {
		return []
	}
}

export function readMentions(bundleDir: string): MentionLookups {
	const mentionsPath = path.join(bundleDir, 'mentions.json')
	if (!fs.existsSync(mentionsPath))
		return { users: {}, channels: {}, roles: {} }
	try {
		return JSON.parse(fs.readFileSync(mentionsPath, 'utf8'))
	} catch {
		return { users: {}, channels: {}, roles: {} }
	}
}

function countAttachments(bundleDir: string): number {
	const dir = path.join(bundleDir, 'attachments')
	if (!fs.existsSync(dir)) return 0
	return fs.readdirSync(dir).length
}

function buildListEntry(
	guildId: string,
	dirName: string,
): ArchiveListEntry | null {
	const bundleDir = path.join(ARCHIVE_ROOT, guildId, dirName)
	const messagesPath = path.join(bundleDir, 'messages.jsonl')
	if (!fs.existsSync(messagesPath)) return null

	let meta: ArchiveMeta
	try {
		meta = readBundleMeta(bundleDir)
	} catch {
		return null
	}

	const lineCount = readJsonlLines(messagesPath).length
	const threadCount = readThreadIndex(bundleDir).length

	return {
		bundlePath: `${guildId}/${dirName}`,
		guildId: meta.guildId,
		channelId: meta.channelId,
		channelName: meta.channelName,
		exportedAt: meta.exportedAt,
		messageCount: Math.max(0, lineCount - 1),
		attachmentCount: countAttachments(bundleDir),
		threadCount,
		threadOnlyChannel: Boolean(meta.threadOnlyChannel),
	}
}

// Walks ARCHIVE_ROOT/<guildId>/<channelBundleDir> (two levels, matching the
// archiver's own layout) -- thread sub-bundles nested under a channel's
// threads/ subdirectory are intentionally not listed at this top level;
// they're reached by drilling into their parent channel's archive instead.
export function listArchives(search?: string): ArchiveListEntry[] {
	if (!fs.existsSync(ARCHIVE_ROOT)) return []

	const entries: ArchiveListEntry[] = []
	for (const guildId of fs.readdirSync(ARCHIVE_ROOT)) {
		const guildDir = path.join(ARCHIVE_ROOT, guildId)
		if (!fs.statSync(guildDir).isDirectory()) continue

		for (const dirName of fs.readdirSync(guildDir)) {
			const entry = buildListEntry(guildId, dirName)
			if (entry) entries.push(entry)
		}
	}

	entries.sort((a, b) => b.exportedAt.localeCompare(a.exportedAt))

	if (!search) return entries
	const q = search.toLowerCase()
	return entries.filter(
		(e) =>
			e.channelName.toLowerCase().includes(q) ||
			e.channelId.includes(q) ||
			e.guildId.includes(q),
	)
}
