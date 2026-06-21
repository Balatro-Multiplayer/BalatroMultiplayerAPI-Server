'use client'

import { Zap } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { setReducedMotion, useReducedMotion } from '@/lib/reduced-motion'

// Sits in the nav next to the theme toggle. On = animated background, off =
// reduced motion (the background freezes on a static frame).
export function MotionToggle() {
  const reduced = useReducedMotion()
  return (
    <div
      className='flex items-center gap-1.5 px-1'
      title={reduced ? 'Background motion: off' : 'Background motion: on'}
    >
      <Zap className='size-4 text-muted-foreground' aria-hidden='true' />
      <Switch
        checked={!reduced}
        onCheckedChange={(on) => setReducedMotion(!on)}
        aria-label='Toggle background motion'
      />
    </div>
  )
}
