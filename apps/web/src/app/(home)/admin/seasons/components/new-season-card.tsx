import type { RefObject } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function NewSeasonCard({
  name,
  endsAt,
  isPending,
  nameRef,
  onNameChange,
  onEndsAtChange,
  onSubmit,
}: {
  name: string
  endsAt: string
  isPending: boolean
  nameRef: RefObject<HTMLInputElement | null>
  onNameChange: (v: string) => void
  onEndsAtChange: (v: string) => void
  onSubmit: (name: string, endsAt: string | null) => void
}) {
  return (
    <section className='space-y-3 rounded-xl border border-border bg-card p-4'>
      <h2 className='font-pixel text-lg'>New season</h2>
      <p className='text-muted-foreground text-sm'>
        Starts a new season and makes it active. This ends the current season.
      </p>
      <div className='space-y-2'>
        <Label htmlFor='s-name'>Name</Label>
        <Input
          id='s-name'
          ref={nameRef}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder='Season 1'
          disabled={isPending}
        />
      </div>
      <div className='space-y-2'>
        <Label htmlFor='s-ends'>Ends at (optional, defaults to 90 days)</Label>
        <Input
          id='s-ends'
          type='date'
          value={endsAt}
          onChange={(e) => onEndsAtChange(e.target.value)}
          disabled={isPending}
        />
      </div>
      <p className='text-muted-foreground text-xs'>
        A note is asked before it sends.
      </p>
      <Button
        disabled={isPending}
        onClick={() => {
          if (!name.trim()) {
            toast.error('Name is required')
            return
          }
          onSubmit(name.trim(), endsAt ? new Date(endsAt).toISOString() : null)
        }}
      >
        {isPending ? 'Starting…' : 'Start season'}
      </Button>
    </section>
  )
}
