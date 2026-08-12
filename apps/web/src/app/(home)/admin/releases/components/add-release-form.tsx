'use client'

import type { FormEvent } from 'react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { LauncherPlatform } from './launcher-releases-types'
import {
  PLATFORM_ACCEPT,
  PLATFORM_LABELS,
  PLATFORMS,
} from './launcher-releases-types'

export function AddReleaseForm({
  isPending,
  onSubmit,
}: {
  isPending: boolean
  onSubmit: (formData: FormData) => void
}) {
  const [version, setVersion] = useState('')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<Partial<Record<LauncherPlatform, File>>>(
    {}
  )

  const hasAnyFile = Object.values(files).some(Boolean)

  function reset() {
    setVersion('')
    setNotes('')
    setFiles({})
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const formData = new FormData()
    formData.set('version', version.trim())
    if (notes.trim()) formData.set('notes', notes.trim())
    for (const platform of PLATFORMS) {
      const file = files[platform]
      if (file) formData.set(platform, file)
    }
    onSubmit(formData)
    reset()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New launcher release</CardTitle>
        <CardDescription>
          Upload a version number plus at least one platform binary. Missing
          platforms can be added later by uploading them against the same
          version below.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='release-version'>Version</Label>
            <Input
              id='release-version'
              placeholder='1.2.0'
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              required
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='release-notes'>Notes (optional)</Label>
            <Input
              id='release-notes'
              placeholder='Changelog summary'
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className='grid gap-4 sm:grid-cols-3'>
            {PLATFORMS.map((platform) => (
              <div key={platform} className='space-y-2'>
                <Label htmlFor={`release-file-${platform}`}>
                  {PLATFORM_LABELS[platform]}
                </Label>
                <Input
                  id={`release-file-${platform}`}
                  type='file'
                  accept={PLATFORM_ACCEPT[platform]}
                  className='file:mr-2 file:rounded-md file:border file:border-input file:bg-secondary file:px-2 file:text-secondary-foreground'
                  onChange={(e) =>
                    setFiles((f) => ({
                      ...f,
                      [platform]: e.target.files?.[0],
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </CardContent>
        <CardFooter className='mt-4'>
          <Button
            type='submit'
            disabled={isPending || !version.trim() || !hasAnyFile}
          >
            {isPending ? 'Uploading…' : 'Upload release'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
