// Builds a link to an archive's detail page from its relative bundlePath
// (e.g. "guildId/channelDir" or "guildId/channelDir/threads/threadDir").
// The [...bundlePath] catch-all route expects each real path component as
// its own URL segment, individually percent-encoded -- NOT the whole
// relative path encoded as one blob (that's what silently broke navigation
// with a single [bundlePath] segment; %2F inside one segment isn't a
// pattern Next's router handles).
export function archiveDetailHref(bundlePath: string): string {
  return `/admin/archives/${bundlePath.split('/').map(encodeURIComponent).join('/')}`
}

// For API calls (through /api/proxy/[...path]/route.ts), NOT page navigation.
// That proxy route decodes %2F back into a real "/" and splits it into extra
// path segments before forwarding upstream -- a known Next.js catch-all
// quirk -- so a bundlePath's internal slashes never survive encodeURIComponent
// through it (the API's own :bundlePath route then 404s on the extra
// segments). base64url has no "/" or "%" to mangle, so it passes through
// untouched; the server decodes it back with Buffer.from(x, 'base64url').
export function encodeBundlePathForApi(bundlePath: string): string {
  return btoa(bundlePath)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
