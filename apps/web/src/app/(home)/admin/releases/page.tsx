'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

interface Release {
  id: number
  name: string
  description: string | null
  version: string
  url: string
  smods_version: string | null
  lovely_version: string | null
  branchId: number
  branchName: string | null
}

interface ReleasesResponse {
  data: Release[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface Branch {
  id: number
  name: string
}

const EMPTY_FORM = {
  id: 0,
  name: '',
  version: '',
  description: '',
  url: '',
  smods_version: 'latest',
  lovely_version: 'latest',
  branchId: 1,
}
type ReleaseForm = typeof EMPTY_FORM

export default function AdminReleasesPage() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const qc = useQueryClient()
  const canAccess = isAdmin || isModerator

  const [search, setSearch] = useState('')
  const [addForm, setAddForm] = useState<ReleaseForm>(EMPTY_FORM)
  const [editForm, setEditForm] = useState<ReleaseForm>(EMPTY_FORM)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Release | null>(null)
  const [branchOpen, setBranchOpen] = useState(false)
  const [newBranch, setNewBranch] = useState('')

  useEffect(() => {
    if (!pending && !canAccess) router.replace('/')
  }, [pending, canAccess, router])

  const releasesQ = useQuery<ReleasesResponse>({
    queryKey: ['admin-releases', search],
    queryFn: () =>
      apiFetch(
        `/webadmin/releases?pageSize=100${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
    enabled: canAccess,
  })
  const branchesQ = useQuery<{ branches: Branch[] }>({
    queryKey: ['admin-branches'],
    queryFn: () => apiFetch('/webadmin/branches'),
    enabled: canAccess,
  })

  const branches = branchesQ.data?.branches ?? []
  const releases = releasesQ.data?.data ?? []

  const onErr = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : 'Request failed')
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-releases'] })

  const addMut = useMutation({
    mutationFn: (body: ReleaseForm) =>
      apiFetch('/webadmin/releases', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success('Release added')
      setAddForm(EMPTY_FORM)
      invalidate()
    },
    onError: onErr,
  })
  const updateMut = useMutation({
    mutationFn: (body: ReleaseForm) =>
      apiFetch(`/webadmin/releases/${body.id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success('Release updated')
      setEditOpen(false)
      invalidate()
    },
    onError: onErr,
  })
  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/webadmin/releases/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Release deleted')
      setDeleteTarget(null)
      invalidate()
    },
    onError: onErr,
  })
  const addBranchMut = useMutation({
    mutationFn: (name: string) =>
      apiFetch('/webadmin/branches', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: () => {
      toast.success('Branch added')
      setNewBranch('')
      qc.invalidateQueries({ queryKey: ['admin-branches'] })
    },
    onError: onErr,
  })
  const deleteBranchMut = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/webadmin/branches/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Branch deleted')
      qc.invalidateQueries({ queryKey: ['admin-branches'] })
    },
    onError: onErr,
  })

  function openEdit(r: Release) {
    setEditForm({
      id: r.id,
      name: r.name,
      version: r.version,
      description: r.description ?? '',
      url: r.url,
      smods_version: r.smods_version ?? 'latest',
      lovely_version: r.lovely_version ?? 'latest',
      branchId: r.branchId,
    })
    setEditOpen(true)
  }

  if (pending) {
    return <div className='container py-8 text-muted-foreground'>Loading…</div>
  }
  if (!canAccess) return null

  return (
    <div className='container max-w-6xl py-8 space-y-8'>
      <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>Releases</h1>
          <p className='text-sm text-muted-foreground'>
            Launcher releases served at <code>/api/releases</code>.
          </p>
        </div>
        <Input
          placeholder='Search releases…'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='w-full sm:max-w-xs'
        />
      </div>

      <div className='overflow-x-auto rounded-lg border border-border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>SMODS</TableHead>
              <TableHead>Lovely</TableHead>
              <TableHead className='text-right'>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {releasesQ.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className='text-muted-foreground'>Loading…</TableCell>
              </TableRow>
            ) : releases.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className='text-muted-foreground'>No releases</TableCell>
              </TableRow>
            ) : (
              releases.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className='font-medium'>{r.name}</TableCell>
                  <TableCell>{r.version}</TableCell>
                  <TableCell>{r.branchName ?? 'main'}</TableCell>
                  <TableCell className='max-w-[220px]'>
                    <a
                      href={r.url}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='block truncate text-bal-blue hover:underline'
                      title={r.url}
                    >
                      {r.url}
                    </a>
                  </TableCell>
                  <TableCell>{r.smods_version ?? 'latest'}</TableCell>
                  <TableCell>{r.lovely_version ?? 'latest'}</TableCell>
                  <TableCell className='space-x-2 text-right'>
                    <Button variant='outline' size='sm' onClick={() => openEdit(r)}>
                      <Pencil className='mr-1 h-4 w-4' /> Edit
                    </Button>
                    <Button variant='destructive' size='sm' onClick={() => setDeleteTarget(r)}>
                      <Trash2 className='mr-1 h-4 w-4' /> Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add new release */}
      <div className='rounded-lg border border-border bg-card p-6'>
        <div className='mb-4 flex items-center justify-between'>
          <h2 className='text-lg font-semibold'>Add New Release</h2>
          <Button type='button' variant='outline' size='sm' onClick={() => setBranchOpen(true)}>
            Manage Branches
          </Button>
        </div>
        <form
          className='space-y-4'
          onSubmit={(e) => {
            e.preventDefault()
            if (!addForm.name.trim() || !addForm.version.trim() || !addForm.url.trim()) {
              toast.error('Name, version, and URL are required')
              return
            }
            addMut.mutate(addForm)
          }}
        >
          <ReleaseFields form={addForm} setForm={setAddForm} branches={branches} idPrefix='add' />
          <Button type='submit' className='w-full' disabled={addMut.isPending}>
            {addMut.isPending ? 'Adding…' : 'Add Release'}
          </Button>
        </form>
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className='sm:max-w-[600px]'>
          <DialogHeader>
            <DialogTitle>Edit Release</DialogTitle>
            <DialogDescription>Update the release details.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              updateMut.mutate(editForm)
            }}
            className='space-y-4'
          >
            <ReleaseFields form={editForm} setForm={setEditForm} branches={branches} idPrefix='edit' />
            <DialogFooter>
              <Button type='button' variant='outline' onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type='submit' disabled={updateMut.isPending}>
                {updateMut.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete release?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes
              {deleteTarget && <strong> “{deleteTarget.name}”</strong>}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-white hover:bg-destructive/90'
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Branch management */}
      <Dialog open={branchOpen} onOpenChange={setBranchOpen}>
        <DialogContent className='sm:max-w-[480px]'>
          <DialogHeader>
            <DialogTitle>Manage Branches</DialogTitle>
            <DialogDescription>Add or remove release channels.</DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='new-branch'>Add branch</Label>
              <div className='flex gap-2'>
                <Input
                  id='new-branch'
                  value={newBranch}
                  onChange={(e) => setNewBranch(e.target.value)}
                  placeholder='e.g. nightly'
                />
                <Button
                  type='button'
                  onClick={() => newBranch.trim() && addBranchMut.mutate(newBranch.trim())}
                  disabled={!newBranch.trim() || branches.some((b) => b.name === newBranch.trim())}
                >
                  Add
                </Button>
              </div>
            </div>
            <div className='space-y-2'>
              <Label>Existing branches</Label>
              <ul className='max-h-60 space-y-1 overflow-y-auto rounded-md border border-border p-2'>
                {branches.map((b) => (
                  <li key={b.id} className='flex items-center justify-between rounded px-2 py-1 hover:bg-muted'>
                    <span>{b.name}</span>
                    {b.name !== 'main' && (
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-7 w-7 p-0 text-destructive'
                        onClick={() => deleteBranchMut.mutate(b.id)}
                      >
                        <Trash2 className='h-4 w-4' />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button type='button' onClick={() => setBranchOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ReleaseFields({
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
