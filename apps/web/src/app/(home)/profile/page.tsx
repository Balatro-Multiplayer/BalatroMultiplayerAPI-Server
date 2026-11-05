'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ApiError, apiFetch } from '@/lib/api'
import { clearToken, setToken, useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { jokers } from '@/shared/jokers'
import { PunishmentsCard } from './punishments-card'
import { type AvatarCatalog, type AvatarEntry, goalText, shownProgress } from './avatar-goals'

function ProfileInfoCard({
  player,
}: {
  player: { displayName: string; steamName: string; discordLinked: boolean; discordUsername: string | null; preferredJoker: string | null; privileges: string[]; usernameBanned?: boolean }
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        {player.usernameBanned ? (
          // While the username ban lasts, one row with the name everyone sees
          // replaces the display, Steam and Discord names.
          <>
            <InfoRow label='Username' value={player.displayName} />
            <p className='text-sm text-muted-foreground'>
              Your name broke the rules, so other players see this name instead. You can appeal below.
            </p>
          </>
        ) : (
          <>
            <InfoRow label='Display Name' value={player.displayName} />
            <Separator />
            <InfoRow label='Steam Name' value={player.steamName} />
            {player.discordLinked && (
              <>
                <Separator />
                <InfoRow label='Discord' value={player.discordUsername ?? 'Linked'} />
              </>
            )}
          </>
        )}
        {player.preferredJoker && (
          <>
            <Separator />
            <InfoRow label='Preferred Joker' value={player.preferredJoker} />
          </>
        )}
        {player.privileges.length > 0 && (
          <>
            <Separator />
            <InfoRow label='Privileges' value={player.privileges.join(', ')} />
          </>
        )}
      </CardContent>
    </Card>
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
      const { url } = await apiFetch<{ url: string }>('/auth/link/discord?source=web', { method: 'POST' })
      window.location.href = url
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed to start Discord linking')
    }
  }

  async function handleUnlinkDiscord() {
    setError(null)
    try {
      // Unlink returns a fresh token (display name may revert); adopt it, then refresh.
      const res = await apiFetch<{ token?: string }>('/auth/unlink/discord', { method: 'POST' })
      if (res?.token) setToken(res.token)
      await onRefresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed to unlink Discord')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Discord</CardTitle>
        <CardDescription>
          Link your Discord account to use your Discord name as your display name.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {player.discordLinked ? (
          <div className='flex items-center justify-between'>
            <p className='text-sm'>
              Linked as <span className='font-semibold'>{player.discordUsername}</span>
            </p>
            <button
              type='button'
              onClick={handleUnlinkDiscord}
              className='text-sm text-destructive hover:underline underline-offset-4'
            >
              Unlink
            </button>
          </div>
        ) : (
          <button
            type='button'
            onClick={handleLinkDiscord}
            className='inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90'
            style={{ background: '#5865f2' }}
          >
            Link Discord
          </button>
        )}
        {error && <p className='text-sm text-destructive'>{error}</p>}
      </CardContent>
    </Card>
  )
}

// §5.2: display-name toggle. Only meaningful once Discord is linked (the
// server 400s a true value otherwise) -- disabled rather than hidden so it's
// clear this exists but needs linking first.
function DisplayNameCard({
  player,
  onRefresh,
}: {
  player: { useDiscordName: boolean; discordLinked: boolean; discordUsername: string | null; steamName: string }
  onRefresh: () => Promise<unknown>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleToggle(useDiscordName: boolean) {
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch<{ token: string }>('/auth/preferences/display-name', {
        method: 'POST',
        body: JSON.stringify({ useDiscordName }),
      })
      setToken(res.token)
      await onRefresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed to update display name')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Display Name</CardTitle>
        <CardDescription>Choose whether other players see your Steam name or your Discord name.</CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        <div className='flex items-center justify-between'>
          <div className='space-y-0.5'>
            <p className='text-sm font-medium'>Use Discord name</p>
            <p className='text-sm text-muted-foreground'>
              {player.discordLinked ? (player.discordUsername ?? 'Linked') : 'Link Discord below to enable this'}
            </p>
          </div>
          <Switch
            checked={player.useDiscordName}
            disabled={!player.discordLinked || saving}
            onCheckedChange={handleToggle}
          />
        </div>
        {error && <p className='text-sm text-destructive'>{error}</p>}
      </CardContent>
    </Card>
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
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed to update avatar')
    } finally {
      setSaving(false)
    }
  }

  const unlockedCount = catalog?.avatars.filter((a) => a.unlocked).length ?? 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Avatar</CardTitle>
        <CardDescription>
          The joker card shown as your avatar to other players.
          {catalog && ` ${unlockedCount} of ${catalog.avatars.length} unlocked.`}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {loadFailed && <p className='text-sm text-muted-foreground'>Avatars are unavailable right now.</p>}
        {catalog && !catalog.enabled && (
          <p className='text-sm text-muted-foreground'>Avatar achievements are paused: games don&apos;t count toward goals right now.</p>
        )}
        {catalog && (
          <div className='grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-3'>
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
        {error && <p className='text-sm text-destructive'>{error}</p>}
      </CardContent>
    </Card>
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
  const progress = !avatar.unlocked && avatar.goal ? shownProgress(avatar.goal) : null
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
      <span className={avatar.unlocked ? 'font-medium' : 'text-muted-foreground'}>{name}</span>
      {!avatar.unlocked && goal && <span className='text-[10px] leading-tight text-muted-foreground'>{goal}</span>}
      {progress && <span className='text-[10px] font-medium text-muted-foreground'>{progress}</span>}
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
      <Card>
        <CardHeader>
          <CardTitle>Chat</CardTitle>
        </CardHeader>
        <CardContent>
          <p className='text-sm text-muted-foreground'>Chat is permanently restricted on this account.</p>
        </CardContent>
      </Card>
    )
  }

  if (player.chatEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Chat</CardTitle>
        </CardHeader>
        <CardContent>
          <p className='text-sm text-muted-foreground'>Chat is enabled on this account.</p>
        </CardContent>
      </Card>
    )
  }

  async function handleEnable() {
    setSaving(true)
    setError(null)
    try {
      await apiFetch('/auth/chat/enable', { method: 'POST' })
      await onRefresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed to enable chat')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chat</CardTitle>
        <CardDescription>Your account predates in-game chat and has never enabled it.</CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        <Button onClick={handleEnable} disabled={saving}>
          {saving ? 'Enabling…' : 'Enable Chat'}
        </Button>
        {error && <p className='text-sm text-destructive'>{error}</p>}
      </CardContent>
    </Card>
  )
}

function SessionCard({ onLogout }: { onLogout: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Session</CardTitle>
      </CardHeader>
      <CardContent>
        <Button variant='outline' onClick={onLogout}>
          Sign Out
        </Button>
      </CardContent>
    </Card>
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
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed to delete account')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card className='border-destructive/50'>
      <CardHeader>
        <CardTitle className='text-destructive'>Danger Zone</CardTitle>
        <CardDescription>
          Permanently delete your account and all associated data. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='space-y-2'>
          <Label htmlFor='delete-confirm' className='text-destructive'>
            Type <span className='font-mono font-bold'>DELETE</span> to confirm
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
          {error && <p className='text-sm text-destructive'>{error}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

export default function ProfilePage() {
  const { player, pending, isLoggedIn, logout, fetchMe } = useAuth()
  const router = useRouter()

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

  return (
    <div className='container max-w-2xl py-8 space-y-6'>
      <h1 className='text-2xl font-bold tracking-tight'>Your Account</h1>
      <PunishmentsCard />
      <ProfileInfoCard player={player} />
      <DisplayNameCard player={player} onRefresh={fetchMe} />
      <AvatarCard player={player} onRefresh={fetchMe} />
      <ChatCard player={player} onRefresh={fetchMe} />
      <DiscordLinkCard player={player} onRefresh={fetchMe} />
      <SessionCard onLogout={logout} />
      <DangerZoneCard onDeleted={() => router.replace('/')} />
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-center justify-between text-sm'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='font-medium'>{value}</span>
    </div>
  )
}
