import type { BanType } from '@bmp/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export const BAN_PRESETS = ['24h', '7d', '30d', 'permanent'] as const
export type BanPreset = (typeof BAN_PRESETS)[number]

const PRESET_HOURS: Record<Exclude<BanPreset, 'permanent'>, number> = {
  '24h': 24,
  '7d': 7 * 24,
  '30d': 30 * 24,
}

// The end of a preset length from now, or null for permanent.
export function presetExpiry(preset: BanPreset): string | null {
  if (preset === 'permanent') return null
  return new Date(Date.now() + PRESET_HOURS[preset] * 3_600_000).toISOString()
}

export function IssueBanForm({
  isAdmin,
  banPreset,
  onPresetChange,
  banType,
  banReason,
  banExpiry,
  isPending,
  onBanTypeChange,
  onReasonChange,
  onExpiryChange,
  onSubmit,
}: {
  // Admins pick any end date. Others pick a preset length, and no account ban.
  isAdmin: boolean
  banPreset: BanPreset
  onPresetChange: (v: BanPreset) => void
  banType: BanType
  banReason: string
  banExpiry: string
  isPending: boolean
  onBanTypeChange: (v: BanType) => void
  onReasonChange: (v: string) => void
  onExpiryChange: (v: string) => void
  onSubmit: () => void
}) {
  return (
    <div className='space-y-2 border-t border-border pt-4'>
      <Label className='text-xs text-muted-foreground'>Issue a ban</Label>
      <Input
        placeholder='Reason'
        value={banReason}
        onChange={(e) => onReasonChange(e.target.value)}
      />
      <div className='flex gap-2'>
        <Select value={banType} onValueChange={(v) => onBanTypeChange(v as BanType)}>
          <SelectTrigger className='w-40'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='chat'>Chat</SelectItem>
            <SelectItem value='queue'>Queue</SelectItem>
            {isAdmin && <SelectItem value='account'>Account</SelectItem>}
          </SelectContent>
        </Select>
        {isAdmin ? (
          <Input
            type='date'
            value={banExpiry}
            onChange={(e) => onExpiryChange(e.target.value)}
            className='flex-1'
          />
        ) : (
          <Select
            value={banPreset}
            onValueChange={(v) => onPresetChange(v as BanPreset)}
          >
            <SelectTrigger className='flex-1'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BAN_PRESETS.map((preset) => (
                <SelectItem key={preset} value={preset}>
                  {preset === 'permanent' ? 'Permanent' : preset}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          onClick={onSubmit}
          disabled={!banReason.trim() || isPending}
        >
          Add Ban
        </Button>
      </div>
    </div>
  )
}
