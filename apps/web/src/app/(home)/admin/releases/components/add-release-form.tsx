'use client'

import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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

  // Not-yet-imported tags first, newest first within each group (the API
  // already returns them newest-first) - the whole point of this picker is
  // finding a release to import, so already-imported ones (still shown, for
  // re-importing under a different scenario) shouldn't push those down.
  const sorted = [...githubReleases].sort(
    (a, b) => Number(a.alreadyImported) - Number(b.alreadyImported)
  )

  useEffect(() => {
    if (!tag && sorted[0]) setTag(sorted[0].tag)
  }, [sorted, tag])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!tag) return
    onSubmit(tag)
  }

  const selected = githubReleases.find((r) => r.tag === tag)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import a launcher release</CardTitle>
        <CardDescription>
          Pulls version + platform binaries from a GitHub release already
          built by new-launcher's own CI - nothing is uploaded from this
          browser.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='release-tag'>GitHub release</Label>
            <Select value={tag} onValueChange={setTag}>
              <SelectTrigger id='release-tag' className='w-full'>
                <SelectValue
                  placeholder={
                    isLoadingGithubReleases
                      ? 'Loading releases…'
                      : 'Select a release'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {sorted.map((r) => (
                  <SelectItem key={r.tag} value={r.tag}>
                    {r.name ?? r.tag}
                    {r.alreadyImported ? ' (already imported)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selected?.body ? (
            <div className='space-y-1'>
              <Label className='text-muted-foreground text-xs'>
                Release notes (from GitHub)
              </Label>
              <p className='whitespace-pre-wrap text-muted-foreground text-sm'>
                {selected.body}
              </p>
            </div>
          ) : null}
        </CardContent>
        <CardFooter className='mt-4'>
          <Button type='submit' disabled={isPending || !tag}>
            {isPending
              ? 'Importing…'
              : selected?.alreadyImported
                ? 'Re-import'
                : 'Import release'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
