export const PERMISSION_KEYS = [
  'permissions.manage',
  'seasons.manage',
  'banned_users.manage',
  'moderation.view',
  'moderation.strikes.manage',
  'moderation.bans.manage',
  'blog.manage',
  'logs.manage',
  'logs.download_original',
  'games.view',
  'releases.manage',
  'obs_control.manage',
  'transcripts.view',
  'transcripts.search',
  'leaderboard.snapshots.view',
  'queues.manage',
] as const

export type PermissionKey = (typeof PERMISSION_KEYS)[number]

const PERMISSION_KEY_SET = new Set<string>(PERMISSION_KEYS)

export const ADMIN_NAV_PERMISSIONS = [
  'permissions.manage',
  'seasons.manage',
  'banned_users.manage',
  'moderation.view',
  'blog.manage',
  'logs.manage',
  'games.view',
  'releases.manage',
  'obs_control.manage',
  'transcripts.search',
  'queues.manage',
] as const satisfies readonly PermissionKey[]

export const LEGACY_ROLE_PERMISSIONS = {
  user: [],
  helper: [
    'moderation.view',
    'moderation.strikes.manage',
    'transcripts.view',
    'transcripts.search',
  ],
  admin: [
    'banned_users.manage',
    'moderation.view',
    'moderation.strikes.manage',
    'moderation.bans.manage',
    'blog.manage',
    'logs.manage',
    'logs.download_original',
    'games.view',
    'releases.manage',
    'obs_control.manage',
    'transcripts.view',
    'transcripts.search',
    'leaderboard.snapshots.view',
    'queues.manage',
  ],
  owner: [
    'permissions.manage',
    'seasons.manage',
    'banned_users.manage',
    'moderation.view',
    'moderation.strikes.manage',
    'moderation.bans.manage',
    'blog.manage',
    'logs.manage',
    'logs.download_original',
    'games.view',
    'releases.manage',
    'obs_control.manage',
    'transcripts.view',
    'transcripts.search',
    'leaderboard.snapshots.view',
    'queues.manage',
  ],
} as const satisfies Record<string, readonly PermissionKey[]>

export type PermissionSource =
  | { permissions?: readonly string[] | null }
  | readonly string[]
  | null
  | undefined

type PermissionObject = { permissions?: readonly string[] | null }

export type PermissionGroup = {
  title: string
  permissions: Array<{
    key: PermissionKey
    label: string
    description: string
  }>
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    title: 'Core',
    permissions: [
      {
        key: 'permissions.manage',
        label: 'Manage permissions',
        description: 'Open the permissions manager and edit other users.',
      },
      {
        key: 'seasons.manage',
        label: 'Manage seasons',
        description: 'Create seasons, upload snapshots, and invalidate cache.',
      },
      {
        key: 'banned_users.manage',
        label: 'Manage banned users',
        description: 'Open the banned users page and edit aliases and ids.',
      },
    ],
  },
  {
    title: 'Moderation',
    permissions: [
      {
        key: 'moderation.view',
        label: 'View moderation',
        description: 'Open the moderation panel and search members.',
      },
      {
        key: 'moderation.strikes.manage',
        label: 'Manage strikes',
        description: 'Give and remove strikes.',
      },
      {
        key: 'moderation.bans.manage',
        label: 'Manage bans',
        description: 'Create, edit, and lift bans.',
      },
    ],
  },
  {
    title: 'Queue',
    permissions: [
      {
        key: 'queues.manage',
        label: 'Manage queues',
        description: 'View and edit queue settings from the bot.',
      },
    ],
  },
  {
    title: 'Content',
    permissions: [
      {
        key: 'blog.manage',
        label: 'Manage blog',
        description: 'Create, edit, delete, and publish blog posts.',
      },
      {
        key: 'releases.manage',
        label: 'Manage releases',
        description: 'Edit releases, branches, and release ZIP uploads.',
      },
    ],
  },
  {
    title: 'Logs And Data',
    permissions: [
      {
        key: 'logs.manage',
        label: 'Manage logs',
        description: 'Browse, inspect, and delete uploaded logs.',
      },
      {
        key: 'logs.download_original',
        label: 'Download original logs',
        description: 'Download original uploaded log files from the parser UI.',
      },
      {
        key: 'games.view',
        label: 'View games',
        description: 'Open the extracted games admin page and API.',
      },
      {
        key: 'leaderboard.snapshots.view',
        label: 'View leaderboard snapshots',
        description: 'Access internal leaderboard snapshot history.',
      },
      {
        key: 'transcripts.view',
        label: 'View transcripts',
        description: 'Open internal transcript pages and transcript API.',
      },
      {
        key: 'transcripts.search',
        label: 'Search transcript lobby codes',
        description:
          'Search lobby codes extracted from internal match transcripts.',
      },
    ],
  },
  {
    title: 'Stream',
    permissions: [
      {
        key: 'obs_control.manage',
        label: 'Manage OBS controls',
        description: 'Open the OBS control panel.',
      },
    ],
  },
]

export function normalizePermissions(
  source: readonly string[] | null | undefined
): PermissionKey[] {
  if (!source?.length) return []

  const seen = new Set<PermissionKey>()
  for (const value of source) {
    if (PERMISSION_KEY_SET.has(value)) {
      seen.add(value as PermissionKey)
    }
  }

  return PERMISSION_KEYS.filter((permission) => seen.has(permission))
}

function isPermissionObject(
  source: PermissionSource
): source is PermissionObject {
  return Boolean(source) && !Array.isArray(source)
}

function extractPermissions(source: PermissionSource): readonly string[] {
  if (Array.isArray(source)) return source
  if (isPermissionObject(source)) {
    return source.permissions ?? []
  }
  return []
}

export function hasPermission(
  source: PermissionSource,
  permission: PermissionKey
) {
  return extractPermissions(source).includes(permission)
}

export function hasAnyPermission(
  source: PermissionSource,
  permissions: readonly PermissionKey[]
) {
  const available = extractPermissions(source)
  return permissions.some((permission) => available.includes(permission))
}

export function requirePermission(
  source: PermissionSource,
  permission: PermissionKey
) {
  if (!hasPermission(source, permission)) {
    throw new Error(`Missing permission: ${permission}`)
  }
}
