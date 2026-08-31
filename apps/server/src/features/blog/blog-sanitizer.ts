import sanitizeHtml from 'sanitize-html'

// The allowlist here is not just an XSS guard (posts are only ever authored
// by admins/moderators) -- it's the actual contract with the launcher,
// which renders bodyHtml natively in a Qt QLabel via Qt's built-in
// rich-text engine (a documented HTML4 subset, no embedded browser). Tiptap
// on the admin site is configured to only ever produce these tags in the
// first place; this sanitizer is the enforced guarantee for what actually
// reaches the database and, from there, every launcher - not just a
// best-effort trim of whatever the editor happened to emit.
//
// Deliberately excluded: images (Qt's QLabel can't fetch network images,
// only local/data: URIs, and the launcher's card is too small at ~460px
// wide for one to be worth the complexity - see h3-only heading below for
// the same "fits a small card" reasoning), tables, blockquote, code blocks,
// text color/highlight (would clash with the launcher's fixed dark theme),
// underline/strike.
export function sanitizeBlogHtml(rawHtml: string): string {
	return sanitizeHtml(rawHtml, {
		allowedTags: ['p', 'h3', 'b', 'strong', 'i', 'em', 'ul', 'ol', 'li', 'br', 'a'],
		allowedAttributes: {
			a: ['href', 'rel', 'target'],
		},
		allowedSchemes: ['http', 'https'],
		transformTags: {
			// Force-consistent rel/target regardless of what Tiptap emitted --
			// a post author choosing "open in same tab" shouldn't be able to
			// navigate a user's launcher-embedded label away/open an
			// unreferenced popup.
			a: sanitizeHtml.simpleTransform('a', { rel: 'noopener', target: '_blank' }),
		},
	})
}
