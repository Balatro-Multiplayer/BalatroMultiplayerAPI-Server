type AnalyzeAnte = {
  boss: string | null
  n: number | null
  packs: string[]
  tags: string[]
  voucher: string | null
}

export type WarningGameContext = {
  firstAnte: AnalyzeAnte | null
  shopQueuePreview: string[]
}

export type WarningGameContextInput = {
  deck: string
  seed: string
}

function formatIndexedLines(items: string[], indent = '  ') {
  return items.map((item, index) => `${indent}${index + 1}. ${item}`)
}

function normalizeString(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[]
  }

  return value.flatMap((entry) => {
    const normalized = normalizeString(entry)
    return normalized ? [normalized] : []
  })
}

function normalizeAnte(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const ante = value as {
    boss?: unknown
    n?: unknown
    packs?: unknown
    tags?: unknown
    voucher?: unknown
  }

  return {
    n:
      typeof ante.n === 'number' && Number.isFinite(ante.n)
        ? Math.trunc(ante.n)
        : null,
    boss: normalizeString(ante.boss),
    voucher: normalizeString(ante.voucher),
    tags: normalizeStringArray(ante.tags),
    packs: normalizeStringArray(ante.packs),
  } satisfies AnalyzeAnte
}

export function parseWarningGameContext(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const payload = value as {
    antes?: unknown
    shopQueue?: unknown
  }

  const normalizedAntes = Array.isArray(payload.antes)
    ? payload.antes
        .map((ante) => normalizeAnte(ante))
        .filter((ante): ante is AnalyzeAnte => ante !== null)
    : []
  const firstAnte =
    normalizedAntes.find((ante) => ante.n === 1) ?? normalizedAntes[0] ?? null
  const shopQueuePreview = normalizeStringArray(payload.shopQueue).slice(0, 12)

  if (!firstAnte && shopQueuePreview.length === 0) {
    return null
  }

  return {
    firstAnte,
    shopQueuePreview,
  } satisfies WarningGameContext
}

export function formatWarningGameContextLines(context: WarningGameContext) {
  const lines: string[] = []
  const hasAnteDetails =
    Boolean(context.firstAnte?.boss) ||
    Boolean(context.firstAnte?.voucher) ||
    (context.firstAnte?.tags.length ?? 0) > 0 ||
    (context.firstAnte?.packs.length ?? 0) > 0

  if (hasAnteDetails) {
    lines.push('Ante 1')
  }

  if (context.firstAnte?.boss) {
    lines.push(`- Boss: ${context.firstAnte.boss}`)
  }

  if (context.firstAnte?.voucher) {
    lines.push(`- Voucher: ${context.firstAnte.voucher}`)
  }

  if (context.firstAnte && context.firstAnte.tags.length > 0) {
    lines.push(`- Tags: ${context.firstAnte.tags.join(', ')}`)
  }

  if (context.firstAnte && context.firstAnte.packs.length > 0) {
    lines.push('- Packs:')
    lines.push(...formatIndexedLines(context.firstAnte.packs))
  }

  if (context.shopQueuePreview.length > 0) {
    lines.push('Shop queue')
    lines.push(...formatIndexedLines(context.shopQueuePreview))
  }

  return lines
}

export async function fetchWarningGameContext(input: WarningGameContextInput) {
  const { env } = await import('@/env')
  const url = new URL('/analyze', env.SEED_URL)
  url.searchParams.set('seed', input.seed)
  url.searchParams.set('deck', input.deck)

  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${env.SEED_API_KEY}`,
    },
  }).catch(() => null)

  if (!response?.ok) {
    return null
  }

  const payload = await response.json().catch(() => null)
  return parseWarningGameContext(payload)
}
