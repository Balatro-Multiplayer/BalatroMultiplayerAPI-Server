import { eq, inArray } from 'drizzle-orm'
import { db } from '@/server/db'
import {
  bannedUserAliases,
  bannedUserIds,
  bannedUsers,
} from '@/server/db/schema'

export type BannedUserRegistryEntry = {
  id: number
  label: string
  aliases: string[]
  ids: string[]
  createdAt: Date
  updatedAt: Date
}

export type BannedUserMatch = {
  entryId: number
  label: string
  matchedAliases: string[]
  matchedIds: string[]
}

function uniqueCaseInsensitive(values: readonly string[]) {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) {
      continue
    }

    const lower = trimmed.toLowerCase()
    if (seen.has(lower)) {
      continue
    }

    seen.add(lower)
    normalized.push(trimmed)
  }

  return normalized
}

export function normalizeBannedUserValues(values: readonly string[]) {
  return uniqueCaseInsensitive(values).map((value) => ({
    value,
    valueLower: value.toLowerCase(),
  }))
}

function buildValuesByLower(values: readonly string[]) {
  const valuesByLower = new Map<string, string[]>()

  for (const value of uniqueCaseInsensitive(values)) {
    const lower = value.toLowerCase()
    const current = valuesByLower.get(lower) ?? []
    current.push(value)
    valuesByLower.set(lower, current)
  }

  return valuesByLower
}

export async function listBannedUserRegistryEntries(
  entryIds?: readonly number[]
): Promise<BannedUserRegistryEntry[]> {
  if (entryIds && entryIds.length === 0) {
    return []
  }

  const where = entryIds ? inArray(bannedUsers.id, [...entryIds]) : undefined

  const entries = await db
    .select({
      id: bannedUsers.id,
      label: bannedUsers.label,
      createdAt: bannedUsers.createdAt,
      updatedAt: bannedUsers.updatedAt,
    })
    .from(bannedUsers)
    .where(where)

  if (entries.length === 0) {
    return []
  }

  const ids = entries.map((entry) => entry.id)
  const [aliases, registryIds] = await Promise.all([
    db
      .select({
        bannedUserId: bannedUserAliases.bannedUserId,
        value: bannedUserAliases.alias,
      })
      .from(bannedUserAliases)
      .where(inArray(bannedUserAliases.bannedUserId, ids)),
    db
      .select({
        bannedUserId: bannedUserIds.bannedUserId,
        value: bannedUserIds.value,
      })
      .from(bannedUserIds)
      .where(inArray(bannedUserIds.bannedUserId, ids)),
  ])

  const aliasesByUserId = new Map<number, string[]>()
  const idsByUserId = new Map<number, string[]>()

  for (const alias of aliases) {
    const current = aliasesByUserId.get(alias.bannedUserId) ?? []
    current.push(alias.value)
    aliasesByUserId.set(alias.bannedUserId, current)
  }

  for (const registryId of registryIds) {
    const current = idsByUserId.get(registryId.bannedUserId) ?? []
    current.push(registryId.value)
    idsByUserId.set(registryId.bannedUserId, current)
  }

  const hydratedEntries = entries.map((entry) => ({
    ...entry,
    aliases: uniqueCaseInsensitive(aliasesByUserId.get(entry.id) ?? []),
    ids: uniqueCaseInsensitive(idsByUserId.get(entry.id) ?? []),
  }))

  if (!entryIds) {
    return hydratedEntries.sort((a, b) => a.label.localeCompare(b.label))
  }

  const order = new Map(entryIds.map((id, index) => [id, index]))
  return hydratedEntries.sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
  )
}

export function matchBannedUsers(
  entries: readonly BannedUserRegistryEntry[],
  input: {
    aliases?: readonly string[]
    ids?: readonly string[]
  }
): BannedUserMatch[] {
  const aliasesByLower = buildValuesByLower(input.aliases ?? [])
  const idsByLower = buildValuesByLower(input.ids ?? [])

  return entries.flatMap((entry) => {
    const matchedAliases = uniqueCaseInsensitive(
      entry.aliases.flatMap(
        (alias) => aliasesByLower.get(alias.toLowerCase()) ?? []
      )
    )
    const matchedIds = uniqueCaseInsensitive(
      entry.ids.flatMap((value) => idsByLower.get(value.toLowerCase()) ?? [])
    )

    if (matchedAliases.length === 0 && matchedIds.length === 0) {
      return []
    }

    return [
      {
        entryId: entry.id,
        label: entry.label,
        matchedAliases,
        matchedIds,
      },
    ]
  })
}

export async function getBannedUserRegistryEntry(entryId: number) {
  const [entry] = await db
    .select({
      id: bannedUsers.id,
      label: bannedUsers.label,
      createdAt: bannedUsers.createdAt,
      updatedAt: bannedUsers.updatedAt,
    })
    .from(bannedUsers)
    .where(eq(bannedUsers.id, entryId))

  if (!entry) {
    return null
  }

  const [aliases, ids] = await Promise.all([
    db
      .select({ value: bannedUserAliases.alias })
      .from(bannedUserAliases)
      .where(eq(bannedUserAliases.bannedUserId, entryId)),
    db
      .select({ value: bannedUserIds.value })
      .from(bannedUserIds)
      .where(eq(bannedUserIds.bannedUserId, entryId)),
  ])

  return {
    ...entry,
    aliases: uniqueCaseInsensitive(aliases.map((alias) => alias.value)),
    ids: uniqueCaseInsensitive(ids.map((row) => row.value)),
  }
}
