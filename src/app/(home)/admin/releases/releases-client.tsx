'use client'

import { Pencil, Trash2 } from 'lucide-react'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { useDebounceCallback } from 'usehooks-ts'
import { PaginationControls } from '@/app/_components/pagination-controls'
import { SortableHeader } from '@/app/_components/sortable-header'
import { TableShell } from '@/app/_components/table-shell'
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
import {
  Dropzone,
  DropzoneDescription,
  DropzoneGroup,
  DropzoneInput,
  DropzoneTitle,
  DropzoneUploadIcon,
  DropzoneZone,
} from '@/components/ui/dropzone'
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
import { api } from '@/trpc/react'

type SortBy = 'createdAt' | 'name' | 'version' | 'branchName'

export function ReleasesClient() {
  const utils = api.useUtils()
  const pageSize = 50
  const [queryParams, setQueryParams] = useQueryStates(
    {
      page: parseAsInteger.withDefault(1),
      search: parseAsString,
      sortBy: parseAsString.withDefault('createdAt'),
      sortOrder: parseAsString.withDefault('desc'),
    },
    { history: 'push' }
  )

  const { page, search } = queryParams
  const sortBy = (
    ['createdAt', 'name', 'version', 'branchName'] as const
  ).includes(queryParams.sortBy as SortBy)
    ? (queryParams.sortBy as SortBy)
    : 'createdAt'
  const sortOrder = (queryParams.sortOrder === 'asc' ? 'asc' : 'desc') as
    | 'asc'
    | 'desc'
  const updateSearch = useDebounceCallback((nextSearch: string) => {
    setQueryParams({ search: nextSearch || null, page: 1 })
  }, 400)

  const [releasesRes] = api.releases.getReleases.useSuspenseQuery({
    page,
    pageSize,
    search: search || undefined,
    sortBy,
    sortOrder,
  })
  const releases = releasesRes.data
  const addRelease = api.releases.addRelease.useMutation({
    onSuccess: () => {
      utils.releases.getReleases.invalidate()
      toast.success('Release added successfully')
      form.reset()
    },
    onError: (error) => {
      toast.error(`Error adding release: ${error.message}`)
    },
  })
  const updateRelease = api.releases.updateRelease.useMutation({
    onSuccess: () => {
      utils.releases.getReleases.invalidate()
      toast.success('Release updated successfully')
      setEditDialogOpen(false)
    },
    onError: (error) => {
      toast.error(`Error updating release: ${error.message}`)
    },
  })
  const deleteRelease = api.releases.deleteRelease.useMutation({
    onSuccess: () => {
      utils.releases.getReleases.invalidate()
      toast.success('Release deleted successfully')
      setDeleteDialogOpen(false)
    },
    onError: (error) => {
      toast.error(`Error deleting release: ${error.message}`)
    },
  })

  const [smodsVersions, setSmodsVersions] = useState<string[]>(['latest'])
  const [lovelyVersions, setLovelyVersions] = useState<string[]>(['latest'])
  const [newBranch, setNewBranch] = useState<string>('')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Fetch branches from the database
  const [branches] = api.branches.getBranches.useSuspenseQuery()

  // Handle file upload
  const [editIsUploading, setEditIsUploading] = useState(false)
  const [editUploadError, setEditUploadError] = useState<string | null>(null)

  const handleFileUpload = async (files: File[], isEdit = false) => {
    if (files.length === 0) return

    const file = files[0]
    if (!file) {
      return
    }
    if (!file.name.endsWith('.zip')) {
      toast.error('Only zip files are allowed')
      return
    }

    if (isEdit) {
      setEditIsUploading(true)
      setEditUploadError(null)
    } else {
      setIsUploading(true)
      setUploadError(null)
    }

    try {
      const formData = new FormData()
      if (!file) {
        return
      }
      formData.append('file', file)

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to upload file')
      }

      const data = await response.json()

      // Update the URL field in the form
      if (isEdit) {
        editForm.setValue('url', data.url)
      } else {
        form.setValue('url', data.url)
      }
      toast.success('File uploaded successfully')
    } catch (error) {
      console.error('Error uploading file:', error)
      if (isEdit) {
        setEditUploadError(
          error instanceof Error ? error.message : 'Failed to upload file'
        )
      } else {
        setUploadError(
          error instanceof Error ? error.message : 'Failed to upload file'
        )
      }
      toast.error('Failed to upload file')
    } finally {
      if (isEdit) {
        setEditIsUploading(false)
      } else {
        setIsUploading(false)
      }
    }
  }
  // Add branch mutation
  const addBranch = api.branches.addBranch.useMutation({
    onSuccess: () => {
      utils.branches.getBranches.invalidate()
      toast.success('Branch added successfully')
      setNewBranch('')
    },
    onError: (error) => {
      toast.error(`Error adding branch: ${error.message}`)
    },
  })

  // Delete branch mutation
  const deleteBranch = api.branches.deleteBranch.useMutation({
    onSuccess: () => {
      utils.branches.getBranches.invalidate()
      toast.success('Branch deleted successfully')
    },
    onError: (error) => {
      toast.error(`Error deleting branch: ${error.message}`)
    },
  })

  const handleAddBranch = () => {
    if (newBranch && !branches.some((branch) => branch.name === newBranch)) {
      addBranch.mutate({ name: newBranch })
    }
  }
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [branchManagementOpen, setBranchManagementOpen] = useState(false)
  const [selectedRelease, setSelectedRelease] = useState<
    (typeof releases)[number] | null
  >(null)

  const SMODS_RELEASES_URL =
    'https://api.github.com/repos/Steamodded/smods/releases'
  const _LOVELY_RELEASES_BASE_URL =
    'https://github.com/ethangreen-dev/lovely-injector/releases'

  useEffect(() => {
    // Fetch Steamodded versions
    fetch(SMODS_RELEASES_URL)
      .then((response) => response.json())
      .then((data) => {
        const versions = (data as Array<{ tag_name?: string }>).flatMap((r) =>
          typeof r.tag_name === 'string' ? [r.tag_name] : []
        )
        setSmodsVersions(['latest', ...versions])
      })
      .catch((error) => {
        console.error('Error fetching Steamodded versions:', error)
      })

    // Fetch lovely injector versions
    // Since we don't have a direct API for lovely injector, we'll use GitHub API
    fetch(
      'https://api.github.com/repos/ethangreen-dev/lovely-injector/releases'
    )
      .then((response) => response.json())
      .then((data) => {
        const versions = (data as Array<{ tag_name?: string }>).flatMap((r) =>
          typeof r.tag_name === 'string' ? [r.tag_name] : []
        )
        setLovelyVersions(['latest', ...versions])
      })
      .catch((error) => {
        console.error('Error fetching lovely injector versions:', error)
      })
  }, [])

  const form = useForm({
    defaultValues: {
      name: '',
      version: '',
      description: '',
      url: '',
      smods_version: 'latest',
      lovely_version: 'latest',
      branchId: 1,
    },
  })

  const editForm = useForm({
    defaultValues: {
      id: 0,
      name: '',
      version: '',
      description: '',
      url: '',
      smods_version: 'latest',
      lovely_version: 'latest',
      branchId: 1,
    },
  })

  const handleEditRelease = (release: (typeof releases)[0]) => {
    setSelectedRelease(release)
    editForm.reset({
      id: release.id,
      name: release.name,
      version: release.version,
      description: release.description || '',
      url: release.url,
      smods_version: release.smods_version || 'latest',
      lovely_version: release.lovely_version || 'latest',
      branchId: release.branchId,
    })
    setEditDialogOpen(true)
  }

  const handleDeleteRelease = (release: (typeof releases)[0]) => {
    setSelectedRelease(release)
    setDeleteDialogOpen(true)
  }

  const handleSort = (column: string) => {
    const nextOrder = sortBy === column && sortOrder === 'asc' ? 'desc' : 'asc'
    setQueryParams({ sortBy: column, sortOrder: nextOrder, page: 1 })
  }
  return (
    <div className='space-y-8'>
      <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
        <h1 className='font-bold text-3xl'>Releases</h1>
        <Input
          key={search ?? ''}
          placeholder='Search releases...'
          defaultValue={search ?? ''}
          onChange={(e) => updateSearch(e.target.value)}
          className='w-full sm:max-w-sm'
        />
      </div>

      <TableShell className='overflow-hidden shadow-sm'>
        <div className='overflow-x-auto'>
          <Table className='w-full table-auto'>
            <TableHeader className='sticky top-0 z-10 bg-background'>
              <TableRow className='bg-muted/50'>
                <TableHead>
                  <SortableHeader
                    column='name'
                    label='Name'
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={handleSort}
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    column='version'
                    label='Version'
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={handleSort}
                  />
                </TableHead>
                <TableHead>Description</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>
                  <SortableHeader
                    column='branchName'
                    label='Branch'
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={handleSort}
                  />
                </TableHead>
                <TableHead>Steamodded Version</TableHead>
                <TableHead>Lovely Injector Version</TableHead>
                <TableHead className='text-right'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {releases.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8}>No releases</TableCell>
                </TableRow>
              ) : (
                releases.map((release) => (
                  <TableRow key={release.id}>
                    <TableCell className='font-medium'>
                      {release.name}
                    </TableCell>
                    <TableCell>{release.version}</TableCell>
                    <TableCell className='max-w-xs'>
                      <div
                        className='truncate'
                        title={release.description || ''}
                      >
                        {release.description}
                      </div>
                    </TableCell>
                    <TableCell className='max-w-xs'>
                      <a
                        href={release.url}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='text-blue-500 hover:underline'
                        title={release.url}
                      >
                        <div className='truncate'>{release.url}</div>
                      </a>
                    </TableCell>
                    <TableCell>{release.branchName || 'main'}</TableCell>
                    <TableCell>{release.smods_version || 'latest'}</TableCell>
                    <TableCell>{release.lovely_version || 'latest'}</TableCell>
                    <TableCell className='space-x-2 text-right'>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => handleEditRelease(release)}
                        className='inline-flex items-center'
                      >
                        <Pencil className='mr-1 h-4 w-4' />
                        Edit
                      </Button>
                      <Button
                        variant='destructive'
                        size='sm'
                        onClick={() => handleDeleteRelease(release)}
                        className='inline-flex items-center text-white'
                      >
                        <Trash2 className='mr-1 h-4 w-4' />
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <PaginationControls
          currentPage={page}
          totalPages={releasesRes.totalPages ?? 1}
          total={releasesRes.total ?? 0}
          pageSize={pageSize}
          itemLabel='releases'
          onPageChange={(p) => setQueryParams({ page: p })}
          className='rounded-none border-0 border-t bg-background'
        />
      </TableShell>

      <div className='mt-8 overflow-hidden rounded-md border bg-card shadow-sm'>
        <div className='p-6'>
          <h2 className='mb-4 font-semibold text-2xl'>Add New Release</h2>
          <form
            className='space-y-4'
            onSubmit={form.handleSubmit((values) => addRelease.mutate(values))}
          >
            <div className='grid grid-cols-1 gap-2'>
              <Label htmlFor='name'>Title</Label>
              <Input id='name' {...form.register('name')} />
            </div>
            <div className='grid grid-cols-1 gap-2'>
              <Label htmlFor='version'>Version</Label>
              <Input id='version' {...form.register('version')} />
            </div>
            <div className='grid grid-cols-1 gap-2'>
              <Label htmlFor='description'>Description</Label>
              <Textarea id='description' {...form.register('description')} />
            </div>
            <div className='grid grid-cols-1 gap-2'>
              <Label htmlFor='url'>URL</Label>
              <div className='flex flex-col gap-2'>
                <Input
                  id='url'
                  {...form.register('url')}
                  placeholder='URL will be automatically filled after upload'
                />
                <div className='rounded-md border'>
                  <Dropzone
                    onDropAccepted={(files) => handleFileUpload(files, false)}
                    accept={{
                      'application/zip': ['.zip'],
                    }}
                    maxFiles={1}
                    disabled={isUploading}
                  >
                    <DropzoneZone className='w-full p-4'>
                      <DropzoneInput />
                      <DropzoneGroup className='gap-2'>
                        {isUploading ? (
                          <div className='flex items-center justify-center'>
                            <div className='h-6 w-6 animate-spin rounded-full border-primary border-b-2' />
                          </div>
                        ) : (
                          <DropzoneUploadIcon />
                        )}
                        <DropzoneGroup>
                          <DropzoneTitle>
                            {isUploading
                              ? 'Uploading...'
                              : 'Drop zip file here or click to upload'}
                          </DropzoneTitle>
                          <DropzoneDescription>
                            Upload a zip archive to automatically generate a URL
                          </DropzoneDescription>
                          {uploadError && (
                            <p className='mt-1 text-destructive text-sm'>
                              {uploadError}
                            </p>
                          )}
                        </DropzoneGroup>
                      </DropzoneGroup>
                    </DropzoneZone>
                  </Dropzone>
                </div>
              </div>
            </div>
            <div className='grid grid-cols-3 gap-4'>
              <div className='grid grid-cols-1 gap-2'>
                <Label htmlFor='smods_version'>Steamodded Version</Label>
                <Select
                  defaultValue='latest'
                  onValueChange={(value) =>
                    form.setValue('smods_version', value)
                  }
                >
                  <SelectTrigger id='smods_version'>
                    <SelectValue placeholder='Select Steamodded version' />
                  </SelectTrigger>
                  <SelectContent>
                    {smodsVersions.map((version) => (
                      <SelectItem key={version} value={version}>
                        {version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='grid grid-cols-1 gap-2'>
                <Label htmlFor='lovely_version'>Lovely Injector Version</Label>
                <Select
                  defaultValue='latest'
                  onValueChange={(value) =>
                    form.setValue('lovely_version', value)
                  }
                >
                  <SelectTrigger id='lovely_version'>
                    <SelectValue placeholder='Select Lovely Injector version' />
                  </SelectTrigger>
                  <SelectContent>
                    {lovelyVersions.map((version) => (
                      <SelectItem key={version} value={version}>
                        {version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='grid grid-cols-1 gap-2'>
                <Label htmlFor='branch'>Branch</Label>
                <div className='flex gap-2'>
                  <Select
                    defaultValue={'1'}
                    onValueChange={(value) =>
                      form.setValue('branchId', Number(value))
                    }
                  >
                    <SelectTrigger id='branch'>
                      <SelectValue placeholder='Select branch' />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((branch) => (
                        <SelectItem
                          key={branch.id}
                          value={branch.id.toString()}
                        >
                          {branch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div className='grid grid-cols-1 gap-2'>
              <div className='flex items-center justify-between'>
                <Label htmlFor='branch-management'>Branch Management</Label>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => setBranchManagementOpen(true)}
                >
                  Manage Branches
                </Button>
              </div>
            </div>
            <Button type='submit' className='w-full'>
              Add new release
            </Button>
          </form>
        </div>
      </div>

      {/* Edit Release Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className='sm:max-w-[600px]'>
          <DialogHeader>
            <DialogTitle>Edit Release</DialogTitle>
            <DialogDescription>
              Make changes to the release. Click save when you're done.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={editForm.handleSubmit((values) =>
              updateRelease.mutate(values)
            )}
          >
            <div className='grid gap-4 py-4'>
              <div className='grid grid-cols-1 gap-2'>
                <Label htmlFor='edit-name'>Title</Label>
                <Input id='edit-name' {...editForm.register('name')} />
              </div>
              <div className='grid grid-cols-1 gap-2'>
                <Label htmlFor='edit-version'>Version</Label>
                <Input id='edit-version' {...editForm.register('version')} />
              </div>
              <div className='grid grid-cols-1 gap-2'>
                <Label htmlFor='edit-description'>Description</Label>
                <Textarea
                  id='edit-description'
                  {...editForm.register('description')}
                />
              </div>
              <div className='grid grid-cols-1 gap-2'>
                <Label htmlFor='edit-url'>URL</Label>
                <div className='flex flex-col gap-2'>
                  <Input
                    id='edit-url'
                    {...editForm.register('url')}
                    placeholder='URL will be automatically filled after upload'
                  />
                  <div className='rounded-md border'>
                    <Dropzone
                      onDropAccepted={(files) => handleFileUpload(files, true)}
                      accept={{
                        'application/zip': ['.zip'],
                      }}
                      maxFiles={1}
                      disabled={editIsUploading}
                    >
                      <DropzoneZone className='w-full p-4'>
                        <DropzoneInput />
                        <DropzoneGroup className='gap-2'>
                          {editIsUploading ? (
                            <div className='flex items-center justify-center'>
                              <div className='h-6 w-6 animate-spin rounded-full border-primary border-b-2' />
                            </div>
                          ) : (
                            <DropzoneUploadIcon />
                          )}
                          <DropzoneGroup>
                            <DropzoneTitle>
                              {editIsUploading
                                ? 'Uploading...'
                                : 'Drop zip file here or click to upload'}
                            </DropzoneTitle>
                            <DropzoneDescription>
                              Upload a zip archive to automatically generate a
                              URL
                            </DropzoneDescription>
                            {editUploadError && (
                              <p className='mt-1 text-destructive text-sm'>
                                {editUploadError}
                              </p>
                            )}
                          </DropzoneGroup>
                        </DropzoneGroup>
                      </DropzoneZone>
                    </Dropzone>
                  </div>
                </div>
              </div>
              <div className='grid grid-cols-3 gap-4'>
                <div className='grid grid-cols-1 gap-2'>
                  <Label htmlFor='edit-smods_version'>Steamodded Version</Label>
                  <Select
                    value={editForm.watch('smods_version')}
                    onValueChange={(value) =>
                      editForm.setValue('smods_version', value)
                    }
                  >
                    <SelectTrigger id='edit-smods_version'>
                      <SelectValue placeholder='Select Steamodded version' />
                    </SelectTrigger>
                    <SelectContent>
                      {smodsVersions.map((version) => (
                        <SelectItem key={version} value={version}>
                          {version}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className='grid grid-cols-1 gap-2'>
                  <Label htmlFor='edit-lovely_version'>
                    Lovely Injector Version
                  </Label>
                  <Select
                    value={editForm.watch('lovely_version')}
                    onValueChange={(value) =>
                      editForm.setValue('lovely_version', value)
                    }
                  >
                    <SelectTrigger id='edit-lovely_version'>
                      <SelectValue placeholder='Select Lovely Injector version' />
                    </SelectTrigger>
                    <SelectContent>
                      {lovelyVersions.map((version) => (
                        <SelectItem key={version} value={version}>
                          {version}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className='grid grid-cols-1 gap-2'>
                  <Label htmlFor='edit-branch'>Branch</Label>
                  <Select
                    value={editForm.watch('branchId').toString()}
                    onValueChange={(value) =>
                      editForm.setValue('branchId', Number(value))
                    }
                  >
                    <SelectTrigger id='edit-branch'>
                      <SelectValue placeholder='Select branch' />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((branch) => (
                        <SelectItem
                          key={branch.id}
                          value={branch.id.toString()}
                        >
                          {branch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => setEditDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type='submit'>Save changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              release
              {selectedRelease && <strong> "{selectedRelease.name}"</strong>}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className='bg-red-600 text-white hover:bg-red-700'
              onClick={() =>
                selectedRelease &&
                deleteRelease.mutate({ id: selectedRelease.id })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Branch Management Modal */}
      <Dialog
        open={branchManagementOpen}
        onOpenChange={setBranchManagementOpen}
      >
        <DialogContent className='sm:max-w-[500px]'>
          <DialogHeader>
            <DialogTitle>Manage Branches</DialogTitle>
            <DialogDescription>
              Add new branches or remove existing ones.
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-4 py-4'>
            <div className='grid grid-cols-1 gap-2'>
              <Label htmlFor='modal-new-branch'>Add New Branch</Label>
              <div className='flex gap-2'>
                <Input
                  id='modal-new-branch'
                  value={newBranch}
                  onChange={(e) => setNewBranch(e.target.value)}
                  placeholder='Enter new branch name'
                />
                <Button
                  type='button'
                  onClick={handleAddBranch}
                  disabled={
                    !newBranch ||
                    branches.some((branch) => branch.name === newBranch)
                  }
                >
                  Add
                </Button>
              </div>
            </div>
            <div className='grid grid-cols-1 gap-2'>
              <Label>Existing Branches</Label>
              <div className='max-h-60 overflow-y-auto rounded-md border p-2'>
                {branches.length === 0 ? (
                  <p className='text-muted-foreground text-sm'>
                    No branches found
                  </p>
                ) : (
                  <ul className='space-y-1'>
                    {branches.map((branch) => (
                      <li
                        key={branch.id}
                        className='flex items-center justify-between rounded-md px-2 py-1 hover:bg-muted'
                      >
                        <span>{branch.name}</span>
                        {branch.name !== 'main' && (
                          <Button
                            variant='ghost'
                            size='sm'
                            className='h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive'
                            onClick={() =>
                              deleteBranch.mutate({ id: branch.id })
                            }
                          >
                            <Trash2 className='h-4 w-4' />
                            <span className='sr-only'>Delete branch</span>
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type='button'
              onClick={() => setBranchManagementOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
