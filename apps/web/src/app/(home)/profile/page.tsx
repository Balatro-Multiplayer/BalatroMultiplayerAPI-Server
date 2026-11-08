'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  KeyValues,
  MainAndSide,
  PageHeader,
  PageShell,
  SideCard,
  TabCard,
  type TabSpec,
} from '@/components/page-kit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ApiError, apiFetch } from '@/lib/api'
import { clearToken, setToken, useAuth } from '@/lib/auth'
import { jokers } from '@/shared/jokers'
import {
  type AvatarCatalog,
  type AvatarEntry,
  goalText,
  shownProgress,
} from './avatar-goals'
import { PunishmentsList, usePunishments } from './punishments-card'

type Me = {
  displayName: string
  steamName: string
  discordLinked: boolean
  discordUsername: string | null
  preferredJoker: string | null
  privileges: string[]
  usernameBanned?: boolean
  chatEnabled: boolean
  chatBlocked: boolean
}

function ProfileFacts({ player }: { player: Me }) {
  const rows: Array<[string, string]> = player.usernameBanned
    ? [['Username', player.displayName]]
    : [
        ['Display name', player.displayName],
        ['Steam name', player.steamName],
      ]
  if (!player.usernameBanned && player.discordLinked)
    rows.push(['Discord', player.discordUsername ?? 'Linked'])
  if (player.preferredJoker)
    rows.push([
      'Avatar',
      jokers[player.preferredJoker]?.name ?? player.preferredJoker,
    ])
  if (player.privileges.length > 0)
    rows.push(['Privileges', player.privileges.join(', ')])
  return (
    <SideCard title='Profile'>
      <KeyValues rows={rows} />
      {player.usernameBanned && (
        // While the username ban lasts, one row with the name everyone sees
        // replaces the display, Steam and Discord names.
        <p className='text-muted-foreground text-sm'>
          Your name broke the rules, so other players see this name instead. You
          can appeal in Punishments.
        </p>
      )}
    </SideCard>
  )
}

// A titled block inside a tab.
function Section({
  title,
  hint,
  children,
  className,
}: {
  title: string
  hint?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`space-y-3 ${className ?? ''}`}>
      <div className='space-y-0.5'>
        <h3 className='font-pixel text-lg uppercase tracking-wide'>{title}</h3>
        {hint && <p className='text-muted-foreground text-sm'>{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function DiscordLinkCard({
  player,
  onRefresh,
}: {
  player: { discordLinked: boolean; discordUsername: string | null }
  onRefresh: () => Promise<unknown>
}) {
  const [error, setError] = useState<string | null>(null)

  // Linking is a POST that requires the JWT (sent by apiFetch), so it can't be a
  // plain <a> navigation. POST → get the Discord OAuth URL → navigate to it.
  async function handleLinkDiscord() {
    setError(null)
    try {
      const { url } = await apiFetch<{ url: string }>(
        '/auth/link/discord?source=web',
        { method: 'POST' }
      )
      window.location.href = url
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to start Discord linking'
      )
    }
  }

  async function handleUnlinkDiscord() {
    setError(null)
    try {
      // Unlink returns a fresh token (display name may revert); adopt it, then refresh.
      const res = await apiFetch<{ token?: string }>('/auth/unlink/discord', {
        method: 'POST',
      })
      if (res?.token) setToken(res.token)
      await onRefresh()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to unlink Discord'
      )
    }
  }

  return (
    <Section
      title='Discord'
      hint='Link your Discord account to use your Discord name as your display name.'
    >
      <div className='space-y-3'>
        {player.discordLinked ? (
          <div className='flex items-center justify-between'>
            <p className='text-sm'>
              Linked as{' '}
              <span className='font-semibold'>{player.discordUsername}</span>
            </p>
            <button
              type='button'
              onClick={handleUnlinkDiscord}
              className='text-destructive text-sm underline-offset-4 hover:underline'
            >
              Unlink
            </button>
          </div>
        ) : (
          <button
            type='button'
            onClick={handleLinkDiscord}
            className='inline-flex items-center gap-2 rounded-md px-4 py-2 font-semibold text-sm text-white transition-opacity hover:opacity-90'
            style={{ background: '#5865f2' }}
          >
            Link Discord
          </button>
        )}
        {error && <p className='text-destructive text-sm'>{error}</p>}
      </div>
    </Section>
  )
}

// §5.2: display-name toggle. Only meaningful once Discord is linked (the
// server 400s a true value otherwise) -- disabled rather than hidden so it's
// clear this exists but needs linking first.
function DisplayNameCard({
  player,
  onRefresh,
}: {
  player: {
    useDiscordName: boolean
    discordLinked: boolean
    discordUsername: string | null
    steamName: string
  }
  onRefresh: () => Promise<unknown>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleToggle(useDiscordName: boolean) {
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch<{ token: string }>(
        '/auth/preferences/display-name',
        {
          method: 'POST',
          body: JSON.stringify({ useDiscordName }),
        }
      )
      setToken(res.token)
      await onRefresh()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to update display name'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      title='Display Name'
      hint='Choose whether other players see your Steam name or your Discord name.'
    >
      <div className='space-y-3'>
        <div className='flex items-center justify-between'>
          <div className='space-y-0.5'>
            <p className='font-medium text-sm'>Use Discord name</p>
            <p className='text-muted-foreground text-sm'>
              {player.discordLinked
                ? (player.discordUsername ?? 'Linked')
                : 'Link Discord below to enable this'}
            </p>
          </div>
          <Switch
            checked={player.useDiscordName}
            disabled={!player.discordLinked || saving}
            onCheckedChange={handleToggle}
          />
        </div>
        {error && <p className='text-destructive text-sm'>{error}</p>}
      </div>
    </Section>
  )
}

// §5.2: avatar (preferredJoker) picker. Every avatar from the server
// (GET /auth/jokers, Nakama's catalog): unlocked ones can be picked, locked
// ones are greyed with their goal and progress.
function AvatarCard({
  player,
  onRefresh,
}: {
  player: { preferredJoker: string | null }
  onRefresh: () => Promise<unknown>
}) {
  const [catalog, setCatalog] = useState<AvatarCatalog | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<AvatarCatalog>('/auth/jokers')
      .then(setCatalog)
      .catch(() => setLoadFailed(true))
  }, [])

  async function handleChange(preferredJoker: string) {
    setSaving(true)
    setError(null)
    try {
      await apiFetch('/auth/preferences/joker', {
        method: 'POST',
        body: JSON.stringify({ preferredJoker }),
      })
      await onRefresh()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to update avatar'
      )
    } finally {
      setSaving(false)
    }
  }

  const unlockedCount = catalog?.avatars.filter((a) => a.unlocked).length ?? 0

  return (
    <Section
      title='Avatar'
      hint={
        <>
          The joker card shown as your avatar to other players.
          {catalog &&
            ` ${unlockedCount} of ${catalog.avatars.length} unlocked.`}
        </>
      }
    >
      <div className='space-y-3'>
        {loadFailed && (
          <p className='text-muted-foreground text-sm'>
            Avatars are unavailable right now.
          </p>
        )}
        {catalog && !catalog.enabled && (
          <p className='text-muted-foreground text-sm'>
            Avatar achievements are paused: games don&apos;t count toward goals
            right now.
          </p>
        )}
        {catalog && (
          <div className='grid max-h-[640px] grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-3 overflow-y-auto pr-1'>
            {catalog.avatars.map((avatar) => (
              <AvatarTile
                key={avatar.id}
                avatar={avatar}
                selected={avatar.id === player.preferredJoker}
                disabled={saving}
                onPick={handleChange}
              />
            ))}
          </div>
        )}
        {error && <p className='text-destructive text-sm'>{error}</p>}
      </div>
    </Section>
  )
}

function AvatarTile({
  avatar,
  selected,
  disabled,
  onPick,
}: {
  avatar: AvatarEntry
  selected: boolean
  disabled: boolean
  onPick: (id: string) => void
}) {
  const art = jokers[avatar.id]
  const name = art?.name ?? avatar.id
  const goal = avatar.goal ? goalText(avatar.goal) : null
  const progress =
    !avatar.unlocked && avatar.goal ? shownProgress(avatar.goal) : null
  return (
    <button
      type='button'
      title={goal ? `${name}: ${goal}` : name}
      aria-pressed={selected}
      disabled={disabled || !avatar.unlocked || selected}
      onClick={() => onPick(avatar.id)}
      className={`flex flex-col items-center gap-1 rounded-md border p-2 text-center text-xs transition-colors ${
        selected ? 'border-primary ring-2 ring-primary' : 'border-transparent'
      } ${avatar.unlocked ? 'hover:bg-muted' : 'cursor-not-allowed'}`}
    >
      {art && (
        <Image
          src={`/cards/${art.file}`}
          alt={name}
          width={56}
          height={75}
          className={`rounded-sm ${avatar.unlocked ? '' : 'opacity-40 grayscale'}`}
        />
      )}
      <span
        className={avatar.unlocked ? 'font-medium' : 'text-muted-foreground'}
      >
        {name}
      </span>
      {!avatar.unlocked && goal && (
        <span className='text-[10px] text-muted-foreground leading-tight'>
          {goal}
        </span>
      )}
      {progress && (
        <span className='font-medium text-[10px] text-muted-foreground'>
          {progress}
        </span>
      )}
    </button>
  )
}

// §5.5: chat-eligibility confirmation. This is NOT a re-verification of age --
// the age-gate is a permanent, one-time signup decision (a 13-15 account is
// chatBlocked forever, and this card never shows for one). It only surfaces
// the legacy catch-up path: an older account predating the age-gate rollout
// that has never explicitly enabled chat.
function ChatCard({
  player,
  onRefresh,
}: {
  player: { chatEnabled: boolean; chatBlocked: boolean }
  onRefresh: () => Promise<unknown>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (player.chatBlocked) {
    return (
      <Section title='Chat'>
        <div className='space-y-3'>
          <p className='text-muted-foreground text-sm'>
            Chat is permanently restricted on this account.
          </p>
        </div>
      </Section>
    )
  }

  if (player.chatEnabled) {
    return (
      <Section title='Chat'>
        <div className='space-y-3'>
          <p className='text-muted-foreground text-sm'>
            Chat is enabled on this account.
          </p>
        </div>
      </Section>
    )
  }

  async function handleEnable() {
    setSaving(true)
    setError(null)
    try {
      await apiFetch('/auth/chat/enable', { method: 'POST' })
      await onRefresh()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to enable chat'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      title='Chat'
      hint='Your account predates in-game chat and has never enabled it.'
    >
      <div className='space-y-3'>
        <Button onClick={handleEnable} disabled={saving}>
          {saving ? 'Enabling…' : 'Enable Chat'}
        </Button>
        {error && <p className='text-destructive text-sm'>{error}</p>}
      </div>
    </Section>
  )
}

function DangerZoneCard({ onDeleted }: { onDeleted: () => void }) {
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDeleteAccount() {
    if (deleteConfirm !== 'DELETE') return
    setDeleting(true)
    setError(null)
    try {
      await apiFetch('/auth/account', { method: 'DELETE' })
      clearToken()
      onDeleted()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to delete account'
      )
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Section
      title='Delete account'
      hint='Permanently delete your account and all associated data. This cannot be undone.'
      className='rounded-md border border-destructive/50 p-4'
    >
      <div className='space-y-4'>
        <div className='space-y-2'>
          <Label htmlFor='delete-confirm' className='text-destructive'>
            Type <span className='font-bold font-mono'>DELETE</span> to confirm
          </Label>
          <div className='flex gap-2'>
            <Input
              id='delete-confirm'
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder='DELETE'
              className='max-w-[160px]'
            />
            <Button
              variant='destructive'
              onClick={handleDeleteAccount}
              disabled={deleteConfirm !== 'DELETE' || deleting}
            >
              {deleting ? 'Deleting…' : 'Delete Account'}
            </Button>
          </div>
          {error && <p className='text-destructive text-sm'>{error}</p>}
        </div>
      </div>
    </Section>
  )
}

type Tab = 'avatar' | 'punishments' | 'name' | 'account'

export default function ProfilePage() {
  const { player, pending, isLoggedIn, logout, fetchMe } = useAuth()
  const router = useRouter()
  const { data: punishments, load: reloadPunishments } = usePunishments()
  const [tab, setTab] = useState<Tab | null>(null)

  useEffect(() => {
    if (!pending && !isLoggedIn) router.replace('/login')
  }, [pending, isLoggedIn, router])

  if (pending) {
    return (
      <div className='container flex min-h-[60vh] items-center justify-center'>
        <p className='text-muted-foreground'>Loading…</p>
      </div>
    )
  }

  if (!player) return null

  const hasPunishments =
    !!punishments &&
    (punishments.punishments.length > 0 || punishments.networkBanned)
  const activeCount =
    punishments?.punishments.filter((p) => p.status === 'active').length ?? 0
  const current: Tab =
    tab ??
    (activeCount > 0 || punishments?.networkBanned ? 'punishments' : 'avatar')
  const chat = player.chatBlocked
    ? 'Restricted'
    : player.chatEnabled
      ? 'On'
      : 'Off'

  const tabs: TabSpec<Tab>[] = [
    { key: 'avatar', label: 'Avatar' },
    ...(hasPunishments
      ? [
          {
            key: 'punishments' as const,
            label: 'Punishments',
            count: punishments.punishments.length,
          },
        ]
      : []),
    { key: 'name', label: 'Name and Discord' },
    { key: 'account', label: 'Account' },
  ]

  return (
    <PageShell>
      <PageHeader
        title={player.displayName}
        meta='Your account'
        badges={
          activeCount > 0 ? (
            <Badge variant='destructive'>{activeCount} active</Badge>
          ) : undefined
        }
        actions={
          <Button variant='outline' onClick={logout}>
            Sign out
          </Button>
        }
      />
      <MainAndSide
        main={
          <TabCard tabs={tabs} current={current} onChange={setTab}>
            {current === 'avatar' && (
              <AvatarCard player={player} onRefresh={fetchMe} />
            )}
            {current === 'punishments' && punishments && hasPunishments && (
              <PunishmentsList
                data={punishments}
                onChange={reloadPunishments}
              />
            )}
            {current === 'name' && (
              <div className='space-y-8'>
                <DisplayNameCard player={player} onRefresh={fetchMe} />
                <DiscordLinkCard player={player} onRefresh={fetchMe} />
              </div>
            )}
            {current === 'account' && (
              <div className='space-y-8'>
                <ChatCard player={player} onRefresh={fetchMe} />
                <DangerZoneCard onDeleted={() => router.replace('/')} />
              </div>
            )}
          </TabCard>
        }
        side={
          <>
            <ProfileFacts player={player} />
            <SideCard title='Standing'>
              <KeyValues
                rows={[
                  ['Active punishments', String(activeCount)],
                  ['Network', punishments?.networkBanned ? 'Banned' : 'Clear'],
                  ['Chat', chat],
                ]}
              />
            </SideCard>
          </>
        }
      />
    </PageShell>
  )
}
