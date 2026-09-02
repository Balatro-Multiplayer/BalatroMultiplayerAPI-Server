// Ports the Discord-flavored markdown renderer from the discord-channel-archiver
// bot's src/scripts/generateViewer.ts almost verbatim (same algorithm,
// already proven against real archives) -- see that file for the full
// rationale on why a sequential regex pipeline is a reasonable
// approximation here rather than a full markdown/AST library.
//
// SAFETY: every code path below either escapes raw text via escapeHtml()
// before it's placed into the output, or builds a hardcoded tag string
// around already-escaped content -- nothing user-authored ever reaches the
// output unescaped. That invariant is what makes it safe for callers to
// render the returned string via dangerouslySetInnerHTML.

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i
const VIDEO_EXT = /\.(mp4|webm|mov)$/i
const CUSTOM_EMOJI_RE = /<(a?):(\w+):(\d+)>/g
const TIMESTAMP_RE = /<t:(-?\d+)(?::([tTdDfFR]))?>/g
const PLACEHOLDER_MARKER = String.fromCharCode(0)

export interface MentionLookups {
  users: Record<string, { username: string; displayName: string | null }>
  channels: Record<string, string>
  roles: Record<string, string>
}

export const EMPTY_MENTIONS: MentionLookups = {
  users: {},
  channels: {},
  roles: {},
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatTimestampTag(unixSeconds: string): string {
  const ms = Number(unixSeconds) * 1000
  if (!Number.isFinite(ms)) return unixSeconds
  return new Date(ms).toLocaleString()
}

/**
 * Renders Discord message/embed text to a safe HTML string.
 * `emojiUrlFor` resolves a custom emoji's src (the caller decides whether
 * that's an archived-attachment API URL or a live Discord CDN fallback).
 */
export function renderMarkdown(
  raw: string,
  emojiUrlFor: (id: string, animated: boolean) => string,
  mentions: MentionLookups
): string {
  const placeholders: string[] = []
  function stash(html: string): string {
    const token = PLACEHOLDER_MARKER + placeholders.length + PLACEHOLDER_MARKER
    placeholders.push(html)
    return token
  }

  let text = raw

  text = text.replace(/```(?:\w+\n)?([\s\S]*?)```/g, (_, code: string) =>
    stash(
      `<pre class="md-codeblock"><code>${escapeHtml(code.replace(/^\n/, ''))}</code></pre>`
    )
  )

  text = text.replace(/`([^`\n]+)`/g, (_, code: string) =>
    stash(`<code class="md-inline-code">${escapeHtml(code)}</code>`)
  )

  text = text.replace(
    CUSTOM_EMOJI_RE,
    (_, animatedFlag: string, name: string, id: string) => {
      const src = emojiUrlFor(id, animatedFlag === 'a')
      return stash(
        `<img class="emoji" src="${escapeHtml(src)}" alt=":${name}:" title=":${name}:" loading="lazy" />`
      )
    }
  )

  text = text.replace(TIMESTAMP_RE, (_, unixSeconds: string) =>
    stash(
      `<span class="timestamp-tag" data-ts="${Number(unixSeconds) * 1000}">${escapeHtml(
        formatTimestampTag(unixSeconds)
      )}</span>`
    )
  )

  text = text.replace(/<@&(\d+)>/g, (_, id: string) => {
    const name = mentions.roles[id]
    return stash(`<span class="mention">@${escapeHtml(name || 'role')}</span>`)
  })
  text = text.replace(/<@!?(\d+)>/g, (_, id: string) => {
    const user = mentions.users[id]
    const name = user ? user.displayName || user.username : 'user'
    return stash(`<span class="mention">@${escapeHtml(name)}</span>`)
  })
  text = text.replace(/<#(\d+)>/g, (_, id: string) => {
    const name = mentions.channels[id]
    return stash(
      `<span class="mention">#${escapeHtml(name || 'channel')}</span>`
    )
  })

  text = escapeHtml(text)

  text = text.replace(/^(?:&gt; ?.*(?:\n|$))+/gm, (block: string) => {
    const inner = block
      .split('\n')
      .filter(Boolean)
      .map((line) => line.replace(/^&gt; ?/, ''))
      .join('\n')
    return `<blockquote class="md-quote">${inner}</blockquote>\n`
  })

  text = text.replace(/^### (.*)$/gm, '<div class="md-h3">$1</div>')
  text = text.replace(/^## (.*)$/gm, '<div class="md-h2">$1</div>')
  text = text.replace(/^# (.*)$/gm, '<div class="md-h1">$1</div>')

  text = text.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/__([\s\S]+?)__/g, '<u>$1</u>')
  text = text.replace(/~~([\s\S]+?)~~/g, '<s>$1</s>')
  text = text.replace(
    /\|\|([\s\S]+?)\|\|/g,
    '<span class="md-spoiler">$1</span>'
  )

  text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
  text = text.replace(/(?<![\w])_([^_\n]+)_(?![\w])/g, '<em>$1</em>')

  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  )
  text = text.replace(
    /(^|[^"'>])(https?:\/\/[^\s<]+)/g,
    '$1<a href="$2" target="_blank" rel="noopener">$2</a>'
  )

  for (let i = 0; i < placeholders.length; i += 1) {
    const token = PLACEHOLDER_MARKER + i + PLACEHOLDER_MARKER
    text = text.split(token).join(placeholders[i])
  }

  return text
}

export function isImageFilename(name: string): boolean {
  return IMAGE_EXT.test(name)
}

export function isVideoFilename(name: string): boolean {
  return VIDEO_EXT.test(name)
}

export interface EmbedField {
  name: string
  value: string
  inline?: boolean
}

export interface Embed {
  title?: string
  description?: string
  url?: string
  color?: number
  fields?: EmbedField[]
  image?: { url: string }
  thumbnail?: { url: string }
  author?: { name?: string; url?: string; icon_url?: string }
  footer?: { text?: string; icon_url?: string }
}

function colorToHex(color: number | undefined | null): string {
  if (color === undefined || color === null) return '#4f545c'
  return `#${color.toString(16).padStart(6, '0')}`
}

export function renderEmbed(
  e: Embed,
  emojiUrlFor: (id: string, animated: boolean) => string,
  mentions: MentionLookups
): string {
  const parts: string[] = []

  if (e.author?.name) {
    const icon = e.author.icon_url
      ? `<img class="embed-author-icon" src="${escapeHtml(e.author.icon_url)}" loading="lazy" />`
      : ''
    const nameHtml = renderMarkdown(e.author.name, emojiUrlFor, mentions)
    const name = e.author.url
      ? `<a href="${escapeHtml(e.author.url)}" target="_blank">${nameHtml}</a>`
      : nameHtml
    parts.push(`<div class="embed-author">${icon}${name}</div>`)
  }

  if (e.title) {
    const titleHtml = renderMarkdown(e.title, emojiUrlFor, mentions)
    const title = e.url
      ? `<a href="${escapeHtml(e.url)}" target="_blank">${titleHtml}</a>`
      : titleHtml
    parts.push(`<div class="embed-title">${title}</div>`)
  }

  if (e.description) {
    parts.push(
      `<div class="embed-description">${renderMarkdown(e.description, emojiUrlFor, mentions)}</div>`
    )
  }

  if (e.fields?.length) {
    const fields = e.fields
      .map(
        (f) =>
          `<div class="embed-field ${f.inline ? 'inline' : ''}">` +
          `<div class="embed-field-name">${renderMarkdown(f.name, emojiUrlFor, mentions)}</div>` +
          `<div class="embed-field-value">${renderMarkdown(f.value, emojiUrlFor, mentions)}</div></div>`
      )
      .join('')
    parts.push(`<div class="embed-fields">${fields}</div>`)
  }

  if (e.thumbnail?.url) {
    parts.push(
      `<img class="embed-thumbnail" src="${escapeHtml(e.thumbnail.url)}" loading="lazy" />`
    )
  }
  if (e.image?.url) {
    parts.push(
      `<img class="embed-image" src="${escapeHtml(e.image.url)}" loading="lazy" />`
    )
  }

  if (e.footer?.text) {
    const icon = e.footer.icon_url
      ? `<img class="embed-footer-icon" src="${escapeHtml(e.footer.icon_url)}" loading="lazy" />`
      : ''
    parts.push(
      `<div class="embed-footer">${icon}${renderMarkdown(e.footer.text, emojiUrlFor, mentions)}</div>`
    )
  }

  return `<div class="embed" style="border-left-color: ${colorToHex(e.color)}">${parts.join('')}</div>`
}

export function renderEmbeds(
  embeds: Embed[],
  emojiUrlFor: (id: string, animated: boolean) => string,
  mentions: MentionLookups
): string {
  if (!embeds?.length) return ''
  return `<div class="embeds">${embeds.map((e) => renderEmbed(e, emojiUrlFor, mentions)).join('')}</div>`
}
