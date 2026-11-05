'use client'

import { apiFetch } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import type { ItemType } from '../../../app/(home)/admin/service-queue/lib/types'
import { fillFromPreset, presetReasonsKey } from './lists'

// The preset reasons of one queue item type as chips. A click fills the note.
export function PresetReasonChips({
  itemType,
  onPick,
  disabled,
}: {
  itemType: ItemType
  onPick: (note: string) => void
  disabled?: boolean
}) {
  const { data } = useQuery<{ presetReasons: Record<string, string[]> }>({
    queryKey: presetReasonsKey,
    queryFn: () => apiFetch('/webadmin/preset-reasons'),
    staleTime: 60_000,
  })
  const list = data?.presetReasons[itemType] ?? []
  if (list.length === 0) return null
  return (
    <div className='flex flex-wrap gap-1.5' data-testid='preset-chips'>
      {list.map((text) => (
        <button
          key={text}
          type='button'
          disabled={disabled}
          onClick={() => onPick(fillFromPreset('', text))}
          className='rounded-full border border-border border-dashed px-3 py-1 text-left text-muted-foreground text-xs hover:bg-accent hover:text-foreground disabled:opacity-50'
        >
          {text}
        </button>
      ))}
    </div>
  )
}
