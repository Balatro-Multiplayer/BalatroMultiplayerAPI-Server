import type { Privilege } from '@bmp/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function PrivilegeManager({
  privileges,
  privInput,
  isPending,
  onRemove,
  onInputChange,
  onGrant,
}: {
  privileges: Privilege[]
  privInput: string
  isPending: boolean
  onRemove: (priv: Privilege) => void
  onInputChange: (v: string) => void
  onGrant: () => void
}) {
  const trimmed = privInput.trim()
  const alreadyHas = privileges.includes(trimmed as Privilege)

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap gap-2'>
        {privileges.length === 0 ? (
          <p className='text-sm text-muted-foreground'>None.</p>
        ) : (
          privileges.map((pr) => (
            <Button
              key={pr}
              variant='outline'
              size='sm'
              className='text-bal-gold'
              onClick={() => onRemove(pr)}
              disabled={isPending}
            >
              {pr} ✕
            </Button>
          ))
        )}
      </div>
      <div className='flex gap-2'>
        <Input
          placeholder='Privilege (e.g. tester)'
          value={privInput}
          onChange={(e) => onInputChange(e.target.value)}
          className='w-44'
          onKeyDown={(e) => {
            if (e.key === 'Enter' && trimmed && !alreadyHas) onGrant()
          }}
        />
        <Button
          variant='outline'
          onClick={onGrant}
          disabled={!trimmed || alreadyHas || isPending}
        >
          Grant
        </Button>
      </div>
    </div>
  )
}
