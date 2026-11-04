'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BanType } from '@bmp/types'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Empty, Facts, Section } from '../../service-queue/components/evidence/shared'
import { formatTime } from '../../service-queue/lib/format'
import {
  type BanPreset,
  IssueBanForm,
  presetExpiry,
} from '../components/issue-ban-form'
import { LadderPick } from '../components/ladder-pick'
import {
  defaultLadderOf,
  LADDER_LABELS,
  LADDERS,
  type Ladder,
  STEP_LABELS,
} from '../lib/strikes'
import type { PageBan, PlayerIdentity, PlayerPage } from '../lib/types'

// Every staff action needs a reason for the staff log; nothing is sent without one.
function askReason(question: string): string | null {
  const reason = window.prompt(question)?.trim()
  return reason || null
}

function Row({ children }: { children: ReactNode }) {
  return (
    <li className='rounded-md border border-border p-2 text-sm'>{children}</li>
  )
}

function isActive(ban: PageBan): boolean {
  return !ban.liftedAt && (!ban.expiresAt || new Date(ban.expiresAt) > new Date())
}

function BanRow({
  ban,
  onLift,
}: {
  ban: PageBan
  onLift: (() => void) | null
}) {
  const active = isActive(ban)
  return (
    <Row>
      <div className='flex items-start justify-between gap-2'>
        <div className='space-y-0.5'>
          <Badge variant={active ? 'destructive' : 'outline'}>
            {ban.banType}
          </Badge>{' '}
          {ban.reason || 'no reason'}
          <p className='text-muted-foreground text-xs'>
            Given by {ban.issuedByName ?? 'unknown'} on{' '}
            {formatTime(ban.issuedAt)}, until{' '}
            {ban.expiresAt ? formatTime(ban.expiresAt) : 'permanent'}
          </p>
          {ban.liftedAt && (
            <p className='text-muted-foreground text-xs'>
              Lifted by {ban.liftedByName ?? 'unknown'} on{' '}
              {formatTime(ban.liftedAt)}
            </p>
          )}
        </div>
        {active && onLift && (
          <Button size='sm' variant='outline' onClick={onLift}>
            Lift
          </Button>
        )}
      </div>
    </Row>
  )
}

function IdentitySection({ playerId }: { playerId: string }) {
  const { data, isError } = useQuery<PlayerIdentity>({
    queryKey: ['admin-player-identity', playerId],
    queryFn: () => apiFetch(`/webadmin/players/${playerId}/identity`),
    retry: false,
  })
  if (isError)
    return (
      <Section title='Identity'>
        <Empty>Identity data is not available right now.</Empty>
      </Section>
    )
  if (!data) return null
  return (
    <Section title='Identity (admins only)'>
      <Facts
        rows={[
          ['Steam id hash', data.steamIdHash ?? '-'],
          ['Discord id hash', data.discordIdHash ?? '-'],
          ['Discord name', data.discordUsername ?? '-'],
          ['Networks (30 days)', String(data.networks.count)],
        ]}
      />
      {data.networks.hashes.length > 0 && (
        <ul className='font-mono text-muted-foreground text-xs'>
          {data.networks.hashes.map((n) => (
            <li key={n.hash} className='break-all'>
              {n.hash} (last seen {formatTime(n.lastSeen)})
            </li>
          ))}
        </ul>
      )}
      <h4 className='pt-2 font-medium text-sm'>Network bans</h4>
      {data.networkBans.length === 0 ? (
        <Empty>None.</Empty>
      ) : (
        <ul className='space-y-1'>
          {data.networkBans.map((b) => (
            <Row key={b.banId}>
              {b.own ? 'Caused by this account' : 'Covers a network it used'},{' '}
              {b.networks} network{b.networks === 1 ? '' : 's'}, from{' '}
              {formatTime(b.bannedAt)}
              {b.liftedAt ? `, lifted ${formatTime(b.liftedAt)}` : ''}
            </Row>
          ))}
        </ul>
      )}
      <h4 className='pt-2 font-medium text-sm'>Linked accounts</h4>
      {data.linkedAccounts.length === 0 ? (
        <Empty>None.</Empty>
      ) : (
        <ul className='space-y-1'>
          {data.linkedAccounts.map((a) => (
            <Row key={a.playerId}>
              <Link
                href={`/admin/players/${a.playerId}`}
                className='text-bal-blue hover:underline'
              >
                {a.name ?? a.playerId}
              </Link>{' '}
              (banned on a network this account used)
            </Row>
          ))}
        </ul>
      )}
    </Section>
  )
}

export default function AdminPlayerPage() {
  const { id } = useParams<{ id: string }>()
  const { isAdmin, isModerator } = useAuth()
  const qc = useQueryClient()
  const canAccess = isAdmin || isModerator

  const [banType, setBanType] = useState<BanType>('chat')
  const [banPreset, setBanPreset] = useState<BanPreset>('7d')
  const [banExpiry, setBanExpiry] = useState('')
  const [banReason, setBanReason] = useState('')
  const [warnMessage, setWarnMessage] = useState('')
  const [warnReason, setWarnReason] = useState('')
  const [note, setNote] = useState('')
  // The ladder each punishment counts on; null follows the ban type.
  const [banLadder, setBanLadder] = useState<Ladder | null>(null)
  const [banDeviation, setBanDeviation] = useState('')
  const [warnLadder, setWarnLadder] = useState<Ladder>('play')
  const [warnDeviation, setWarnDeviation] = useState('')

  const { data, isLoading, error } = useQuery<PlayerPage>({
    queryKey: ['admin-player-page', id],
    queryFn: () => apiFetch(`/webadmin/players/${id}/page`),
    enabled: canAccess,
    retry: false,
  })
  const activeBanLadder: Ladder | null =
    banType === 'account' ? null : (banLadder ?? defaultLadderOf(banType))
  const banRecommended =
    data && activeBanLadder ? data.strikes[activeBanLadder].recommended : null
  // Preselect the recommended length (a staff member can pick another).
  useEffect(() => {
    if (banRecommended && banRecommended !== 'warning')
      setBanPreset(banRecommended)
  }, [banRecommended])
  const banChosen = isAdmin
    ? banExpiry
      ? 'custom'
      : 'permanent'
    : banPreset
  const refresh = () =>
    qc.invalidateQueries({ queryKey: ['admin-player-page', id] })

  const ban = useMutation({
    mutationFn: () =>
      apiFetch(`/webadmin/players/${id}/bans`, {
        method: 'POST',
        body: JSON.stringify({
          type: banType,
          reason: banReason,
          ...(activeBanLadder
            ? {
                ladder: activeBanLadder,
                deviationReason: banDeviation.trim() || undefined,
              }
            : {}),
          expiresAt: isAdmin
            ? banExpiry
              ? new Date(banExpiry).toISOString()
              : null
            : presetExpiry(banPreset),
        }),
      }),
    onSuccess: () => {
      setBanReason('')
      setBanExpiry('')
      setBanDeviation('')
      void refresh()
    },
  })
  const lift = useMutation({
    mutationFn: (vars: { banId: string; reason: string }) =>
      apiFetch(`/webadmin/players/${id}/bans/${vars.banId}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason: vars.reason }),
      }),
    onSuccess: () => void refresh(),
  })
  const warn = useMutation({
    mutationFn: () =>
      apiFetch(`/webadmin/players/${id}/warnings`, {
        method: 'POST',
        body: JSON.stringify({
          message: warnMessage,
          reason: warnReason,
          ladder: warnLadder,
          deviationReason: warnDeviation.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      setWarnMessage('')
      setWarnReason('')
      setWarnDeviation('')
      void refresh()
    },
  })
  const addNote = useMutation({
    mutationFn: () =>
      apiFetch(`/webadmin/players/${id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    onSuccess: () => {
      setNote('')
      void refresh()
    },
  })

  if (!canAccess) return null
  if (isLoading)
    return <div className='container py-8 text-muted-foreground'>Loading…</div>
  if (error || !data)
    return <div className='container py-8'>Player not found.</div>

  const { player, punishments } = data
  const failure = ban.error ?? warn.error ?? addNote.error ?? lift.error

  return (
    <div className='container max-w-4xl space-y-4 py-8'>
      <div>
        <Link
          href='/admin/players'
          className='text-bal-blue text-xs hover:underline'
        >
          All players
        </Link>
        <h1 className='font-bold text-2xl tracking-tight'>
          {player.steamName}
        </h1>
        <p className='font-mono text-muted-foreground text-xs'>{player.id}</p>
        <div className='flex flex-wrap gap-1 pt-1'>
          {player.privileges.map((p) => (
            <Badge key={p} variant='secondary'>
              {p}
            </Badge>
          ))}
          {player.deletedAt && <Badge variant='destructive'>deleted</Badge>}
          <Link
            href={`/players/${player.id}`}
            className='text-bal-blue text-xs hover:underline'
          >
            Public profile
          </Link>
        </div>
      </div>

      {failure && (
        <p className='text-red-400 text-sm'>{(failure as Error).message}</p>
      )}

      <Section title='Punishments'>
        {punishments.bans.length === 0 && punishments.warnings.length === 0 ? (
          <Empty>No punishments on record.</Empty>
        ) : (
          <ul className='space-y-1'>
            {punishments.bans.map((b) => (
              <BanRow
                key={b.id}
                ban={b}
                onLift={
                  isAdmin
                    ? () => {
                        const reason = askReason('Reason for lifting this ban')
                        if (reason) lift.mutate({ banId: b.id, reason })
                      }
                    : null
                }
              />
            ))}
            {punishments.warnings.map((w) => (
              <Row key={w.id}>
                <Badge variant='outline'>warning</Badge> {w.message}
                <p className='text-muted-foreground text-xs'>
                  Given by {w.issuedByName ?? 'unknown'} on{' '}
                  {formatTime(w.issuedAt)}
                </p>
              </Row>
            ))}
          </ul>
        )}
        <IssueBanForm
          isAdmin={isAdmin}
          banPreset={banPreset}
          onPresetChange={setBanPreset}
          banType={banType}
          banReason={banReason}
          banExpiry={banExpiry}
          isPending={ban.isPending}
          onBanTypeChange={setBanType}
          onReasonChange={setBanReason}
          onExpiryChange={setBanExpiry}
          onSubmit={() => ban.mutate()}
          canSubmit={
            !activeBanLadder ||
            banChosen === banRecommended ||
            banDeviation.trim() !== ''
          }
          ladderSlot={
            activeBanLadder && (
              <LadderPick
                ladder={activeBanLadder}
                onLadderChange={setBanLadder}
                recommended={banRecommended}
                chosen={banChosen}
                deviationReason={banDeviation}
                onDeviationReasonChange={setBanDeviation}
              />
            )
          }
        />
        <div className='space-y-2 border-border border-t pt-3'>
          <Label className='text-muted-foreground text-xs'>
            Send a warning
          </Label>
          <Textarea
            placeholder='Message the player sees'
            value={warnMessage}
            onChange={(e) => setWarnMessage(e.target.value)}
          />
          <LadderPick
            ladder={warnLadder}
            onLadderChange={setWarnLadder}
            recommended={data.strikes[warnLadder].recommended}
            chosen='warning'
            deviationReason={warnDeviation}
            onDeviationReasonChange={setWarnDeviation}
          />
          <div className='flex gap-2'>
            <Input
              placeholder='Reason (staff log)'
              value={warnReason}
              onChange={(e) => setWarnReason(e.target.value)}
            />
            <Button
              onClick={() => warn.mutate()}
              disabled={
                !warnMessage.trim() ||
                !warnReason.trim() ||
                warn.isPending ||
                (data.strikes[warnLadder].recommended !== 'warning' &&
                  !warnDeviation.trim())
              }
            >
              Warn
            </Button>
          </div>
        </div>
      </Section>

      <Section title='Strikes'>
        {LADDERS.map((ladder) => {
          const summary = data.strikes[ladder]
          return (
            <div key={ladder} className='space-y-1' data-testid={`strikes-${ladder}`}>
              <h4 className='font-medium text-sm'>
                {LADDER_LABELS[ladder]}: {summary.counting.length} counting,
                next step {STEP_LABELS[summary.recommended]}
              </h4>
              {summary.counting.length === 0 ? (
                <Empty>No strikes count now.</Empty>
              ) : (
                <ul className='space-y-1'>
                  {summary.counting.map((s) => (
                    <Row key={s.id}>
                      {STEP_LABELS[s.appliedStep]}, given{' '}
                      {formatTime(s.issuedAt)}
                      <p className='text-muted-foreground text-xs'>
                        Stops counting {formatTime(s.stopsCountingAt)}
                        {s.deviationReason
                          ? `. Recommended was ${STEP_LABELS[s.recommendedStep]}: ${s.deviationReason}`
                          : ''}
                      </p>
                    </Row>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </Section>

      <Section title={`Matches (${data.matchTotal})`}>
        {data.matches.length === 0 ? (
          <Empty>No matches.</Empty>
        ) : (
          <ul className='space-y-1'>
            {data.matches.map((m) => (
              <Row key={m.id}>
                <Link
                  href={`/matches/${m.id}`}
                  className='text-bal-blue hover:underline'
                >
                  {m.modId} ({m.lobbyType}, {m.status})
                </Link>{' '}
                <span className='text-muted-foreground text-xs'>
                  {formatTime(m.startedAt)}
                </span>
              </Row>
            ))}
          </ul>
        )}
      </Section>

      <Section title='Queue items'>
        {data.queueItems.length === 0 ? (
          <Empty>No queue items about this player.</Empty>
        ) : (
          <ul className='space-y-1'>
            {data.queueItems.map((i) => (
              <Row key={i.id}>
                <Link
                  href={`/admin/service-queue/${i.id}`}
                  className='text-bal-blue hover:underline'
                >
                  #{i.id}
                </Link>{' '}
                <Badge variant='outline'>{i.itemType}</Badge> {i.summary}{' '}
                <span className='text-muted-foreground text-xs'>
                  {i.status === 'open'
                    ? 'open'
                    : `closed (${i.resolutionAction ?? 'resolved'})`}
                  , {formatTime(i.createdAt)}
                </span>
              </Row>
            ))}
          </ul>
        )}
      </Section>

      <Section title='Chat'>
        {data.chat.length === 0 ? (
          <Empty>No chat lines.</Empty>
        ) : (
          <ul className='space-y-1'>
            {data.chat.map((c) => (
              <Row key={c.id}>
                {c.flagged && <Badge variant='destructive'>flagged</Badge>}{' '}
                {c.message}{' '}
                <span className='text-muted-foreground text-xs'>
                  {c.lobbyCode}, {formatTime(c.sentAt)}
                </span>
              </Row>
            ))}
          </ul>
        )}
      </Section>

      <Section title='Launcher integrity failures'>
        {data.integrityEvents.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <ul className='space-y-1'>
            {data.integrityEvents.map((e) => (
              <Row key={e.id}>
                {e.kind}: {e.reason}{' '}
                <span className='text-muted-foreground text-xs'>
                  {formatTime(e.occurredAt)}
                </span>
              </Row>
            ))}
          </ul>
        )}
      </Section>

      <Section title='Staff notes'>
        {data.notes.length === 0 ? (
          <Empty>No notes.</Empty>
        ) : (
          <ul className='space-y-1'>
            {data.notes.map((n) => (
              <Row key={n.id}>
                {n.note}
                <p className='text-muted-foreground text-xs'>
                  {n.authorName ?? 'unknown'}, {formatTime(n.createdAt)}
                </p>
              </Row>
            ))}
          </ul>
        )}
        <div className='flex gap-2'>
          <Input
            placeholder='Add a note'
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            onClick={() => addNote.mutate()}
            disabled={!note.trim() || addNote.isPending}
          >
            Add note
          </Button>
        </div>
      </Section>

      {isAdmin && <IdentitySection playerId={player.id} />}
    </div>
  )
}
