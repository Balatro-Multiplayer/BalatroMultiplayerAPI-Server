import type { NextRequest } from 'next/server'

const API_SERVER = process.env.API_SERVER_URL ?? 'http://localhost:8788'

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const url = new URL(`${API_SERVER}/api/${path.join('/')}`)
  url.search = req.nextUrl.search

  const headers = new Headers(req.headers)
  headers.delete('host')

  const upstream = await fetch(url.toString(), {
    method: req.method,
    headers,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
    // @ts-expect-error — Node fetch duplex option
    duplex: 'half',
  })

  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  })
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
