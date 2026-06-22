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

export function IssueBanForm({
  banType,
  banReason,
  banExpiry,
  isPending,
  onBanTypeChange,
  onReasonChange,
  onExpiryChange,
  onSubmit,
}: {
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
            <SelectItem value='account'>Account</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type='date'
          value={banExpiry}
          onChange={(e) => onExpiryChange(e.target.value)}
          className='flex-1'
        />
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
