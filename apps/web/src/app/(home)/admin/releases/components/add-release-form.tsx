import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ReleaseFields } from './release-fields'
import type { Branch, ReleaseForm } from './releases-types'

export function AddReleaseForm({
  form,
  branches,
  isPending,
  onFormChange,
  onSubmit,
  onManageBranches,
}: {
  form: ReleaseForm
  branches: Branch[]
  isPending: boolean
  onFormChange: (f: ReleaseForm) => void
  onSubmit: (f: ReleaseForm) => void
  onManageBranches: () => void
}) {
  return (
    <div className='rounded-lg border border-border bg-card p-6'>
      <div className='mb-4 flex items-center justify-between'>
        <h2 className='text-lg font-semibold'>Add New Release</h2>
        <Button type='button' variant='outline' size='sm' onClick={onManageBranches}>
          Manage Branches
        </Button>
      </div>
      <form
        className='space-y-4'
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.name.trim() || !form.version.trim() || !form.url.trim()) {
            toast.error('Name, version, and URL are required')
            return
          }
          onSubmit(form)
        }}
      >
        <ReleaseFields form={form} setForm={onFormChange} branches={branches} idPrefix='add' />
        <Button type='submit' className='w-full' disabled={isPending}>
          {isPending ? 'Adding…' : 'Add Release'}
        </Button>
      </form>
    </div>
  )
}
