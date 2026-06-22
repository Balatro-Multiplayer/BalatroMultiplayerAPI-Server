'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ApiError, apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Input } from '@/components/ui/input'
import { AddReleaseForm } from './components/add-release-form'
import { BranchManagementDialog } from './components/branch-management-dialog'
import { DeleteReleaseDialog } from './components/delete-release-dialog'
import { EditReleaseDialog } from './components/edit-release-dialog'
import { ReleasesTable } from './components/releases-table'
import { EMPTY_FORM } from './components/releases-types'
import type { Branch, Release, ReleaseForm } from './components/releases-types'

interface ReleasesResponse {
  data: Release[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

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
    toast.error(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Request failed')
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

      <ReleasesTable
        releases={releases}
        isLoading={releasesQ.isLoading}
        onEdit={openEdit}
        onDelete={setDeleteTarget}
      />

      <AddReleaseForm
        form={addForm}
        branches={branches}
        isPending={addMut.isPending}
        onFormChange={setAddForm}
        onSubmit={(f) => addMut.mutate(f)}
        onManageBranches={() => setBranchOpen(true)}
      />

      <EditReleaseDialog
        open={editOpen}
        form={editForm}
        branches={branches}
        isPending={updateMut.isPending}
        onFormChange={setEditForm}
        onSave={() => updateMut.mutate(editForm)}
        onClose={() => setEditOpen(false)}
      />

      <DeleteReleaseDialog
        target={deleteTarget}
        isPending={deleteMut.isPending}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        onClose={() => setDeleteTarget(null)}
      />

      <BranchManagementDialog
        open={branchOpen}
        branches={branches}
        newBranch={newBranch}
        addPending={addBranchMut.isPending}
        deletePending={deleteBranchMut.isPending}
        onNewBranchChange={setNewBranch}
        onAdd={() => newBranch.trim() && addBranchMut.mutate(newBranch.trim())}
        onDelete={(id) => deleteBranchMut.mutate(id)}
        onClose={() => setBranchOpen(false)}
      />
    </div>
  )
}
