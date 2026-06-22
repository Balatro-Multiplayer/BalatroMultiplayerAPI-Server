import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { Branch, ReleaseForm } from './releases-types'

export function ReleaseFields({
  form,
  setForm,
  branches,
  idPrefix,
}: {
  form: ReleaseForm
  setForm: (f: ReleaseForm) => void
  branches: Branch[]
  idPrefix: string
}) {
  const set = (patch: Partial<ReleaseForm>) => setForm({ ...form, ...patch })
  return (
    <>
      <div className='grid gap-2'>
        <Label htmlFor={`${idPrefix}-name`}>Title</Label>
        <Input id={`${idPrefix}-name`} value={form.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div className='grid gap-2'>
        <Label htmlFor={`${idPrefix}-version`}>Version</Label>
        <Input id={`${idPrefix}-version`} value={form.version} onChange={(e) => set({ version: e.target.value })} />
      </div>
      <div className='grid gap-2'>
        <Label htmlFor={`${idPrefix}-desc`}>Description</Label>
        <Textarea id={`${idPrefix}-desc`} value={form.description} onChange={(e) => set({ description: e.target.value })} />
      </div>
      <div className='grid gap-2'>
        <Label htmlFor={`${idPrefix}-url`}>URL</Label>
        <Input id={`${idPrefix}-url`} value={form.url} onChange={(e) => set({ url: e.target.value })} placeholder='https://…/release.zip' />
      </div>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
        <div className='grid gap-2'>
          <Label htmlFor={`${idPrefix}-smods`}>Steamodded</Label>
          <Input id={`${idPrefix}-smods`} value={form.smods_version} onChange={(e) => set({ smods_version: e.target.value })} />
        </div>
        <div className='grid gap-2'>
          <Label htmlFor={`${idPrefix}-lovely`}>Lovely</Label>
          <Input id={`${idPrefix}-lovely`} value={form.lovely_version} onChange={(e) => set({ lovely_version: e.target.value })} />
        </div>
        <div className='grid gap-2'>
          <Label htmlFor={`${idPrefix}-branch`}>Branch</Label>
          <Select value={String(form.branchId)} onValueChange={(v) => set({ branchId: Number(v) })}>
            <SelectTrigger id={`${idPrefix}-branch`}>
              <SelectValue placeholder='Branch' />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={String(b.id)}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </>
  )
}
