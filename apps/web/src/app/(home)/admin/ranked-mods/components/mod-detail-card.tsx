'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { apiFetch } from '@/lib/api'
import {
  type ModPatch,
  type ModSummary,
  type ModVersion,
  parseIdList,
  type VersionSource,
} from './ranked-mods-types'

// Radix Select items can't have an empty string value -- this sentinel
// stands in for "not ranked" (rankedVersion: null) on the wire in/out of
// the dropdown only, never sent to the API itself.
const NONE_VALUE = '__none__'

const SOURCE_LABEL: Record<VersionSource, string> = {
  thunderstore: 'Thunderstore',
  github: 'GitHub',
}

// The pinned download under the version picker: where it comes from, a link
// to the exact archive that was hashed, and the sync's health flag.
function PinDetails({ mod }: { mod: ModSummary }) {
  if (!mod.rankedVersion) return null
  if (!mod.rankedDownloadUrl) {
    return (
      <p className='mt-1 text-muted-foreground text-xs'>
        Resolving on next sync…
      </p>
    )
  }
  return (
    <p className='mt-1 flex items-center gap-1.5 text-muted-foreground text-xs'>
      {mod.rankedSource && SOURCE_LABEL[mod.rankedSource]}
      <a
        href={mod.rankedDownloadUrl}
        className='underline underline-offset-2'
        target='_blank'
        rel='noreferrer'
      >
        download
      </a>
      {mod.rankedDownloadStatus === 'unavailable' && (
        <Badge variant='destructive'>Unavailable, pin again</Badge>
      )}
    </p>
  )
}

// Options are fetched lazily (only once this row's dropdown is actually
// opened) via GET /webadmin/mods/:id/versions, which returns the mod's merged
// version list -- Thunderstore versions first, then GitHub-only ones -- so
// any of them can be pinned. Avoids fetching every mod's versions up front
// for a table where most rows will never be touched.
function RankedVersionSelect({
  mod,
  disabled,
  onChange,
}: {
  mod: ModSummary
  disabled: boolean
  onChange: (version: string | null) => void
}) {
  const [open, setOpen] = useState(false)

  const { data: versions, isLoading } = useQuery<ModVersion[]>({
    queryKey: ['mod-versions', mod.id],
    queryFn: () =>
      apiFetch(`/webadmin/mods/${encodeURIComponent(mod.id)}/versions`),
    enabled: open,
  })

  // Before the dropdown has ever been opened (or while its fetch is in
  // flight), fall back to just the currently-selected version (if any) so
  // the trigger has a matching SelectItem to render a label from instead of
  // going blank.
  const options: Pick<ModVersion, 'version' | 'source' | 'aliases'>[] =
    versions ??
    (mod.rankedVersion
      ? [
          {
            version: mod.rankedVersion,
            source: mod.rankedSource ?? 'thunderstore',
            aliases: [],
          },
        ]
      : [])

  return (
    <Select
      value={mod.rankedVersion ?? NONE_VALUE}
      disabled={disabled}
      onOpenChange={setOpen}
      onValueChange={(value) => onChange(value === NONE_VALUE ? null : value)}
    >
      <SelectTrigger size='sm' className='h-9 w-full font-mono text-xs'>
        <SelectValue placeholder='None' />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_VALUE}>None</SelectItem>
        {isLoading && !versions && (
          <div className='px-2 py-1.5 text-muted-foreground text-xs'>
            Loading versions…
          </div>
        )}
        {options.map((v) => (
          <SelectItem key={v.version} value={v.version}>
            <span className='font-mono'>{v.version}</span>
            <span className='text-muted-foreground text-xs'>
              {SOURCE_LABEL[v.source]}
              {v.aliases.length > 0 && ` · also ${v.aliases.join(', ')}`}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}


// The SMODS ids the pinned mod reports in a client's mod list: the entries it
// adds to matchmaking's allowed mods. Read from the pin's files; an admin can
// correct them (a re-pin reads them again).
function SmodsIdsField({
  mod,
  editable,
  onSave,
}: {
  mod: ModSummary
  editable: boolean
  onSave: (smodsIds: string[]) => void
}) {
  const saved = mod.smodsIds.join(', ')
  const [draft, setDraft] = useState(saved)
  const dirty = draft !== saved
  return (
    <form
      className='space-y-1.5'
      onSubmit={(e) => {
        e.preventDefault()
        onSave(parseIdList(draft))
      }}
    >
      <label
        htmlFor='mod-smods-ids'
        className='block text-muted-foreground text-xs'
      >
        SMODS ids, comma separated
        {mod.smodsIds.length === 0 && (
          <Badge variant='destructive' className='ml-2'>
            none read
          </Badge>
        )}
      </label>
      <div className='flex gap-2'>
        <Input
          id='mod-smods-ids'
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder='ModId, OtherId'
          disabled={!editable}
          className='font-mono text-xs'
        />
        {dirty && (
          <Button size='sm' type='submit' disabled={!editable}>
            Save
          </Button>
        )}
      </div>
    </form>
  )
}

export function ModDetailCard({
  mod,
  isAdmin,
  busy,
  onUpdate,
  onPinCommit,
  onEdit,
  onDelete,
}: {
  mod: ModSummary | undefined
  isAdmin: boolean
  busy: boolean
  onUpdate: (mod: ModSummary, patch: ModPatch) => void
  onPinCommit: (mod: ModSummary) => void
  onEdit: (mod: ModSummary) => void
  onDelete: (mod: ModSummary) => void
}) {
  if (!mod) {
    return (
      <section className='rounded-xl border border-border bg-card p-4 text-muted-foreground text-sm'>
        Pick a mod to see its pin.
      </section>
    )
  }
  const disabled = !isAdmin || busy
  return (
    <section className='space-y-4 rounded-xl border border-border bg-card p-4'>
      <div className='flex items-start justify-between gap-2'>
        <div>
          <h2 className='font-pixel text-lg'>{mod.title}</h2>
          <p className='font-mono text-muted-foreground text-xs'>
            {mod.id}
            {mod.thunderstoreFullName &&
              mod.thunderstoreFullName !== mod.id &&
              ` / ${mod.thunderstoreFullName}`}
          </p>
        </div>
        {mod.isCustom && (
          <Badge variant='secondary'>custom, {mod.sourceType}</Badge>
        )}
      </div>

      <div className='space-y-1.5'>
        <p className='text-muted-foreground text-xs'>Pinned version</p>
        <RankedVersionSelect
          mod={mod}
          disabled={disabled}
          onChange={(version) => onUpdate(mod, { rankedVersion: version })}
        />
        <PinDetails mod={mod} />
        {mod.rankedVersionSha256 && (
          <p className='break-all font-mono text-muted-foreground text-xs'>
            sha256 {mod.rankedVersionSha256}
          </p>
        )}
      </div>

      {mod.rankedVersion && (
        <SmodsIdsField
          key={`${mod.id}:${mod.smodsIds.join(',')}`}
          mod={mod}
          editable={!disabled}
          onSave={(smodsIds) => onUpdate(mod, { smodsIds })}
        />
      )}

      {isAdmin && (
        <div className='flex flex-wrap gap-2'>
          {mod.rankedVersion && (
            <Button
              size='sm'
              variant='outline'
              disabled={disabled}
              title='Download the pinned version again and hash it'
              onClick={() =>
                onUpdate(mod, { rankedVersion: mod.rankedVersion })
              }
            >
              Pin again
            </Button>
          )}
          <Button
            size='sm'
            variant='outline'
            disabled={disabled}
            onClick={() => onPinCommit(mod)}
          >
            Pin a commit
          </Button>
          {mod.isCustom && (
            <>
              <Button
                size='sm'
                variant='outline'
                disabled={disabled}
                onClick={() => onEdit(mod)}
              >
                Edit
              </Button>
              <Button
                size='sm'
                variant='outline'
                className='ml-auto border-destructive/60 text-destructive'
                disabled={disabled}
                onClick={() => onDelete(mod)}
              >
                Delete mod...
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  )
}
