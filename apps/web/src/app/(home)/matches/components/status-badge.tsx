import { Badge } from '@/components/ui/badge'
import type { RunStatus } from '../lib/types'

const STATUS_VARIANT: Record<
  RunStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  active: 'default',
  completed: 'secondary',
  abandoned: 'outline',
  terminated: 'destructive',
}

const STATUS_LABEL: Record<RunStatus, string> = {
  active: 'Active',
  completed: 'Completed',
  abandoned: 'Abandoned',
  terminated: 'Terminated',
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
}
