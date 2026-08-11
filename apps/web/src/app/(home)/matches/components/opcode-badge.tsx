import { Badge } from '@/components/ui/badge'

export function OpcodeBadge({ opcode }: { opcode: string }) {
  return (
    <Badge variant='outline' className='font-mono text-[11px]'>
      {opcode}
    </Badge>
  )
}
