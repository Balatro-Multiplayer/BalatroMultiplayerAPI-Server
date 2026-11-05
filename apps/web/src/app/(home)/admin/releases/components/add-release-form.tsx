'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { GithubReleaseOption } from './launcher-releases-types'

export function AddReleaseForm({
  githubReleases,
  isLoadingGithubReleases,
  isPending,
  onSubmit,
}: {
  githubReleases: GithubReleaseOption[]
  isLoadingGithubReleases: boolean
  isPending: boolean
  onSubmit: (tag: string) => void
}) {
  const [tag, setTag] = useState('')

  // Tagged releases not yet imported come first, newest first within each
  // group (the API already returns them newest first).
  const sorted = [...githubReleases].sort(
    (a, b) => Number(a.alreadyImported) - Number(b.alreadyImported)
  )

  useEffect(() => {
    if (!tag && sorted[0]) setTag(sorted[0].tag)
  }, [sorted, tag])

  const selected = githubReleases.find((r) => r.tag === tag)

  return (
    <section className='space-y-3 rounded-xl border border-border bg-card p-4'>
      <h2 className='font-pixel text-lg'>Import from GitHub</h2>
      <p className='text-muted-foreground text-sm'>
        Pulls version and platform file data from a release built by the BET
        Launcher&apos;s own CI. Nothing is uploaded from this browser.
      </p>
      <div className='grid gap-4 md:grid-cols-2'>
        <div>
          <p className='mb-1 font-semibold text-muted-foreground text-xs'>
            GitHub release
          </p>
          <ul className='max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border'>
            {isLoadingGithubReleases && (
              <li className='p-3 text-muted-foreground text-sm'>Loading…</li>
            )}
            {sorted.map((r) => (
              <li key={r.tag}>
                <button
                  type='button'
                  onClick={() => setTag(r.tag)}
                  className={cn(
                    'w-full p-3 text-left',
                    r.tag === tag && 'bg-destructive/10'
                  )}
                >
                  <span className='flex items-center gap-2'>
                    <span className='font-medium font-mono text-sm'>
                      {r.name ?? r.tag}
                    </span>
                    <Badge variant='outline'>
                      {r.alreadyImported ? 'imported' : 'new'}
                    </Badge>
                  </span>
                  <span className='text-muted-foreground text-xs'>
                    Published {new Date(r.publishedAt).toLocaleDateString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className='mb-1 font-semibold text-muted-foreground text-xs'>
            Release notes from GitHub
          </p>
          <p className='h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-border p-3 text-sm'>
            {selected?.body ?? ''}
          </p>
        </div>
      </div>
      <div className='flex items-center justify-between gap-4'>
        <p className='text-muted-foreground text-xs'>
          Tagged releases not yet imported come first. An imported one can be
          imported again.
        </p>
        <Button disabled={isPending || !tag} onClick={() => onSubmit(tag)}>
          {isPending
            ? 'Importing…'
            : selected?.alreadyImported
              ? `Re-import ${selected.tag}`
              : `Import ${selected?.tag ?? 'release'}`}
        </Button>
      </div>
    </section>
  )
}
