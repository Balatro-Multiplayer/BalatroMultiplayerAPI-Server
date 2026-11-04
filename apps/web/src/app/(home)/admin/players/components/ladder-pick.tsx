import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  LADDERS,
  LADDER_LABELS,
  type Ladder,
  type LadderStep,
  STEP_LABELS,
} from '../lib/strikes'

// Which ladder a punishment counts on, the step the ladder recommends, and the
// reason field that a different step needs.
export function LadderPick({
  ladder,
  onLadderChange,
  recommended,
  chosen,
  deviationReason,
  onDeviationReasonChange,
}: {
  ladder: Ladder
  onLadderChange: (ladder: Ladder) => void
  recommended: LadderStep | null
  // The step the staff member has picked, or 'custom' for another length.
  chosen: LadderStep | 'custom'
  deviationReason: string
  onDeviationReasonChange: (reason: string) => void
}) {
  const differs = recommended !== null && chosen !== recommended
  return (
    <div className='space-y-1' data-testid='ladder-pick'>
      <Label className='text-muted-foreground text-xs'>Strike ladder</Label>
      <div className='flex flex-wrap items-center gap-2'>
        <Select
          value={ladder}
          onValueChange={(v) => onLadderChange(v as Ladder)}
        >
          <SelectTrigger className='w-40'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LADDERS.map((l) => (
              <SelectItem key={l} value={l}>
                {LADDER_LABELS[l]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {recommended && (
          <span className='text-muted-foreground text-xs'>
            Recommended: {STEP_LABELS[recommended]}
          </span>
        )}
      </div>
      {differs && (
        <Input
          placeholder={`Why ${STEP_LABELS[chosen].toLowerCase()} and not ${STEP_LABELS[recommended].toLowerCase()}? (required)`}
          value={deviationReason}
          onChange={(e) => onDeviationReasonChange(e.target.value)}
        />
      )}
    </div>
  )
}
