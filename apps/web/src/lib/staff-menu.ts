// The staff menu: one list that the desktop dropdown and the mobile menu
// both render. Admin-only pages are left out for a moderator.
export interface StaffMenuItem {
  href: string
  label: string
  // The item shows the open queue item count.
  showsQueueCount?: boolean
}

export interface StaffMenuGroup {
  label: string
  items: StaffMenuItem[]
}

interface StaffRole {
  isAdmin: boolean
  isModerator: boolean
}

interface Entry extends StaffMenuItem {
  adminOnly?: boolean
}

const MODERATION: Entry[] = [
  {
    href: '/admin/service-queue',
    label: 'Service Queue',
    showsQueueCount: true,
  },
  { href: '/admin/players', label: 'Players' },
  { href: '/admin/lobbies', label: 'Lobbies' },
  { href: '/admin/staff-log', label: 'Staff Log' },
  { href: '/admin/archives', label: 'Discord Archives' },
]

const OPS: Entry[] = [
  { href: '/admin/seasons', label: 'Seasons' },
  { href: '/admin/releases', label: 'BET Releases', adminOnly: true },
  { href: '/admin/blog', label: 'Blog' },
  { href: '/admin/config', label: 'Configuration', adminOnly: true },
  { href: '/admin/ranked-mods', label: 'Ranked Mods', adminOnly: true },
]

export function staffMenuGroups({
  isAdmin,
  isModerator,
}: StaffRole): StaffMenuGroup[] {
  if (!isAdmin && !isModerator) return []
  const visible = (entries: Entry[]): StaffMenuItem[] =>
    entries
      .filter((e) => isAdmin || !e.adminOnly)
      .map(({ adminOnly: _adminOnly, ...item }) => item)
  return [
    { label: 'Moderation', items: visible(MODERATION) },
    { label: 'Ops', items: visible(OPS) },
  ]
}
