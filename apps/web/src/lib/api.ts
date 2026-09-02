import { getToken } from './auth/token'

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api/proxy'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
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
    throw new ApiError(res.status, body?.error ?? `API error ${res.status}`)
  }
  return res.json() as Promise<T>
}

// Auth here is a Bearer header, not a cookie -- a plain <img>/<video> src
// can't attach one, so authenticated binary content (e.g. archived channel
// attachments) has to be fetched as a Blob and turned into an object URL
// instead, the same pattern already used for replay downloads
// (admin/moderation/[reportId]/page.tsx's downloadReplay).
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
