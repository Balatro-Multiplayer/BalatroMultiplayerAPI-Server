'use client'

import Link from 'next/link'
import {
  archiveDetailHref,
  encodeBundlePathForApi,
} from '../../lib/archive-path'
import {
  type Embed,
  isImageFilename,
  isVideoFilename,
  type MentionLookups,
  renderEmbeds,
  renderMarkdown,
} from '../lib/render-content'
import { AuthedImage, AuthedVideo } from './authed-media'

interface ArchivedAttachment {
  id: string
  name: string
  size: number
  contentType: string | null
  localPath: string | null
  downloadError: string | null
}

interface ArchivedReaction {
  emoji: string
  emojiId: string | null
  animated: boolean
  count: number
}

export interface ArchivedMessage {
  id: string
  createdAt: string
  authorUsername: string
  authorDisplayName: string | null
  content: string
  hasThread: boolean
  attachments: ArchivedAttachment[]
  embeds: Embed[]
  reactions: ArchivedReaction[]
}

export interface ThreadSummary {
  id: string
  name: string
  dirName: string
  messageCount: number
  completed: boolean
}

function attachmentApiPath(bundlePath: string, localPath: string): string {
  const filename = localPath.split('/').pop() ?? localPath
  return `/webadmin/archives/${encodeBundlePathForApi(bundlePath)}/attachments/${encodeURIComponent(filename)}`
}

function emojiApiPathFor(bundlePath: string) {
  return (id: string, animated: boolean) =>
    `/webadmin/archives/${encodeBundlePathForApi(bundlePath)}/emojis/${id}.${animated ? 'gif' : 'png'}`
}

function AttachmentView({
  bundlePath,
  a,
}: {
  bundlePath: string
  a: ArchivedAttachment
}) {
  if (!a.localPath) {
    return (
      <div className='text-destructive text-xs'>
        ⚠ {a.name} — {a.downloadError ?? 'not downloaded'}
      </div>
    )
  }
  const apiPath = attachmentApiPath(bundlePath, a.localPath)
  if (isImageFilename(a.name))
    return <AuthedImage apiPath={apiPath} alt={a.name} />
  if (isVideoFilename(a.name)) return <AuthedVideo apiPath={apiPath} />
  return (
    <a
      href={`${process.env.NEXT_PUBLIC_API_BASE ?? '/api/proxy'}${apiPath}`}
      target='_blank'
      rel='noopener noreferrer'
      className='inline-block rounded-lg bg-muted px-3 py-2 text-bal-blue text-sm hover:underline'
    >
      📎 {a.name}{' '}
      <span className='text-muted-foreground'>
        ({Math.round(a.size / 1024)} KB)
      </span>
    </a>
  )
}

function ReactionView({
  bundlePath,
  r,
}: {
  bundlePath: string
  r: ArchivedReaction
}) {
  if (r.emojiId) {
    return (
      <span className='inline-flex items-center gap-1 rounded-lg border border-border bg-muted px-2 py-0.5 text-xs'>
        <AuthedImage
          apiPath={`/webadmin/archives/${encodeBundlePathForApi(bundlePath)}/emojis/${r.emojiId}.${r.animated ? 'gif' : 'png'}`}
          alt={r.emoji}
        />
        <span className='text-muted-foreground'>{r.count}</span>
      </span>
    )
  }
  return (
    <span className='inline-flex items-center gap-1 rounded-lg border border-border bg-muted px-2 py-0.5 text-xs'>
      <span>{r.emoji}</span>
      <span className='text-muted-foreground'>{r.count}</span>
    </span>
  )
}

export function MessageList({
  bundlePath,
  messages,
  threads,
  mentions,
}: {
  bundlePath: string
  messages: ArchivedMessage[]
  threads: ThreadSummary[]
  mentions: MentionLookups
}) {
  const threadsByStarterId = new Map(threads.map((t) => [t.id, t]))
  const emojiUrlFor = emojiApiPathFor(bundlePath)

  return (
    <div className='space-y-4'>
      {messages.map((m) => {
        const thread = m.hasThread ? threadsByStarterId.get(m.id) : undefined
        return (
          <div key={m.id} className='space-y-1'>
            <div className='flex items-baseline gap-2'>
              <span className='font-semibold text-sm'>
                {m.authorDisplayName || m.authorUsername}
              </span>
              <span className='text-muted-foreground text-xs'>
                {new Date(m.createdAt).toLocaleString()}
              </span>
            </div>
            {m.content && (
              <div
                className='archive-content'
                // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown escapes all raw text before building trusted tags around it — see lib/render-content.ts's top-of-file safety note
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(m.content, emojiUrlFor, mentions),
                }}
              />
            )}
            {m.embeds.length > 0 && (
              <div
                className='archive-content'
                // biome-ignore lint/security/noDangerouslySetInnerHtml: same escape-first invariant as above
                dangerouslySetInnerHTML={{
                  __html: renderEmbeds(m.embeds, emojiUrlFor, mentions),
                }}
              />
            )}
            {m.attachments.length > 0 && (
              <div className='flex flex-wrap gap-2'>
                {m.attachments.map((a) => (
                  <AttachmentView key={a.id} bundlePath={bundlePath} a={a} />
                ))}
              </div>
            )}
            {m.reactions.length > 0 && (
              <div className='flex flex-wrap gap-1.5'>
                {m.reactions.map((r, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: reactions have no stable id, and the list never reorders within a message
                  <ReactionView key={i} bundlePath={bundlePath} r={r} />
                ))}
              </div>
            )}
            {thread && (
              <Link
                href={archiveDetailHref(
                  `${bundlePath}/threads/${thread.dirName}`
                )}
                className='inline-block rounded-md bg-muted px-2.5 py-1 text-bal-blue text-xs hover:underline'
              >
                🧵 {thread.name} — {thread.messageCount} messages
                {thread.completed ? '' : ' (partial)'} →
              </Link>
            )}
          </div>
        )
      })}
    </div>
  )
}
