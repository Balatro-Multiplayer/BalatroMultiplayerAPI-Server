const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api/proxy'

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('bmp_token') : null
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw Object.assign(new Error(body?.error ?? `API error ${res.status}`), {
      status: res.status,
    })
  }
  return res.json() as Promise<T>
}
