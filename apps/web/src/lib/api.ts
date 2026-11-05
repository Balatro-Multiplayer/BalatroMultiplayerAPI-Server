import { getToken } from './auth/token'

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api/proxy'

export class ApiError extends Error {
  // body: the refusal as the server sent it (e.g. {error, code, claimedBy}),
  // for callers that act on more than the message.
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: Record<string, unknown> = {}
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const token = getToken()
  // A FormData body needs the browser to set its own
  // 'multipart/form-data; boundary=...' Content-Type -- setting it ourselves
  // (even to the same default below) breaks the multipart boundary.
  const isFormData = init?.body instanceof FormData
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(
      res.status,
      body?.error ?? `API error ${res.status}`,
      typeof body === 'object' && body !== null ? body : {}
    )
  }
  return res.json() as Promise<T>
}

// A staff action needs a written reason (it goes in the staff log). Asks for
// one, adds it to the JSON body and sends the request. A cancelled or empty
// answer throws, and nothing is sent.
export async function apiFetchWithReason<T>(
  path: string,
  init?: RequestInit,
  // A note already written (by the confirm card). Without one, ask for it.
  note?: string
): Promise<T> {
  const reason = (
    note ?? window.prompt('Reason for this action (saved in the staff log):')
  )?.trim()
  if (!reason) throw new Error('A reason is required')
  const body =
    typeof init?.body === 'string' && init.body
      ? { ...JSON.parse(init.body), reason }
      : { reason }
  return apiFetch<T>(path, { ...init, body: JSON.stringify(body) })
}

// Auth here is a Bearer header, not a cookie -- a plain <img>/<video> src
// can't attach one, so authenticated binary content (e.g. archived channel
// attachments) has to be fetched as a Blob and turned into an object URL
// instead, the same pattern already used for replay downloads
// (admin/service-queue/lib/api.ts's downloadReplay).
export async function apiFetchBlob(path: string): Promise<Blob> {
  const token = getToken()
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    throw new ApiError(res.status, `API error ${res.status}`)
  }
  return res.blob()
}
