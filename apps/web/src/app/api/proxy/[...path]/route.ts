import type { NextRequest } from 'next/server'

const API_SERVER = process.env.API_SERVER_URL ?? 'http://localhost:8788'

// Response headers we must NOT forward verbatim:
// - content-encoding / content-length: the runtime already decoded the upstream
//   body, so forwarding these makes the browser try to decode it again, which
//   surfaces as a "content encoding error" (hit on the Steam OAuth redirect).
// - transfer-encoding / connection: hop-by-hop headers, not valid to relay.
const STRIPPED_HEADERS = [
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
]

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const url = new URL(`${API_SERVER}/api/${path.join('/')}`)
  url.search = req.nextUrl.search

  const reqHeaders = new Headers(req.headers)
  reqHeaders.delete('host')

  const upstream = await fetch(url.toString(), {
    method: req.method,
    headers: reqHeaders,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
    // Pass redirects (e.g. OAuth) back to the browser instead of following them
    // server-side and returning a foreign, re-encoded page.
    redirect: 'manual',
    // @ts-expect-error — Node fetch duplex option
    duplex: 'half',
  })

  const resHeaders = new Headers(upstream.headers)
  for (const h of STRIPPED_HEADERS) resHeaders.delete(h)

  return new Response(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  })
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
