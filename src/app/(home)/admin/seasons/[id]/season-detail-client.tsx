'use client'

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  type ChangeEvent,
  type FormEvent,
  startTransition,
  useEffect,
  useRef,
  useState,
} from 'react'
import { toast } from 'sonner'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn, formatDate } from '@/lib/utils'
import {
  LEGACY_QUEUE_ID,
  RANKED_QUEUE_ID,
  SMALLWORLD_QUEUE_ID,
  VANILLA_QUEUE_ID,
} from '@/shared/constants'
import { api } from '@/trpc/react'

export type SeasonDetailPageData = {
  id: number
  name: string
  startDate: string
  endDate: string | null
  isActive: boolean
}

export type SeasonSnapshotPageData = {
  id: number
  seasonId: number
  queueType: string
  queueId: string
  sortOrder: number
  minioKey: string | null
  uploadedBy: string | null
  createdAt: string
}

type QueueConfig = {
  queueType: string
  label: string
  queueId: string
}

type SnapshotTableRow = QueueConfig & {
  snapshot: SeasonSnapshotPageData | null
}

type SortableSnapshotTableRow = QueueConfig & {
  snapshot: SeasonSnapshotPageData
}

const KNOWN_QUEUES: QueueConfig[] = [
  { queueType: 'ranked', label: 'Standard Ranked', queueId: RANKED_QUEUE_ID },
  {
    queueType: 'smallworld',
    label: 'Smallworld',
    queueId: SMALLWORLD_QUEUE_ID,
  },
  { queueType: 'vanilla', label: 'Vanilla', queueId: VANILLA_QUEUE_ID },
  { queueType: 'legacy', label: 'Legacy Ranked', queueId: LEGACY_QUEUE_ID },
]

function parseDateTimeValue(value: string | null) {
  if (!value) return null
  return new Date(value)
}

function buildSnapshotRows(
  snapshots: SeasonSnapshotPageData[]
): SnapshotTableRow[] {
  const snapshotMap = new Map(
    snapshots.map((snapshot) => [snapshot.queueType, snapshot] as const)
  )

  const orderedSnapshotRows = snapshots.map((snapshot) => ({
    queueType: snapshot.queueType,
    label: getQueueLabel(snapshot.queueType),
    queueId: snapshot.queueId,
    snapshot,
  }))

  const missingKnownRows = KNOWN_QUEUES.filter(
    (queue) => !snapshotMap.has(queue.queueType)
  ).map((queue) => ({
    ...queue,
    snapshot: null,
  }))

  return [...orderedSnapshotRows, ...missingKnownRows]
}

function getQueueLabel(queueType: string) {
  const knownQueue = KNOWN_QUEUES.find((queue) => queue.queueType === queueType)
  if (knownQueue) {
    return knownQueue.label
  }

  return queueType
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function isSortableSnapshotRow(
  row: SnapshotTableRow
): row is SortableSnapshotTableRow {
  return row.snapshot !== null
}

function getUploadDate(snapshot: SeasonSnapshotPageData | null) {
  if (!snapshot?.minioKey) {
    return '—'
  }

  const match = snapshot.minioKey.match(/-(\d+)\.json$/)

  if (!match) {
    return formatDate(snapshot.createdAt)
  }

  const timestampValue = match[1]

  if (!timestampValue) {
    return formatDate(snapshot.createdAt)
  }

  const timestamp = Number.parseInt(timestampValue, 10)

  if (Number.isNaN(timestamp)) {
    return formatDate(snapshot.createdAt)
  }

  return formatDate(new Date(timestamp))
}

function truncateMinioKey(value: string | null) {
  if (!value) return '—'
  if (value.length <= 48) return value
  return `${value.slice(0, 24)}...${value.slice(-16)}`
}

type SortableSnapshotRowProps = {
  row: SortableSnapshotTableRow
  actionsDisabled: boolean
  dragDisabled: boolean
  isDeleting: boolean
  isInvalidating: boolean
  isUploading: boolean
  onDelete: () => void
  onInvalidate: () => void
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void
  onUploadInputRef: (node: HTMLInputElement | null) => void
  onUploadSelect: () => void
}

type SnapshotActionState = {
  disabled: boolean
  isDeleting: boolean
  isInvalidating: boolean
  isUploading: boolean
}

type SnapshotActionsProps = SnapshotActionState & {
  hasSnapshot: boolean
  onDelete: () => void
  onInvalidate: () => void
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void
  onUploadInputRef: (node: HTMLInputElement | null) => void
  onUploadSelect: () => void
}

function SnapshotActions({
  disabled,
  hasSnapshot,
  isDeleting,
  isInvalidating,
  isUploading,
  onDelete,
  onInvalidate,
  onUpload,
  onUploadInputRef,
  onUploadSelect,
}: SnapshotActionsProps) {
  return (
    <div className='flex flex-wrap gap-2'>
      <input
        ref={onUploadInputRef}
        type='file'
        accept='.json,application/json'
        className='hidden'
        onChange={onUpload}
      />

      <Button
        type='button'
        variant='outline'
        size='sm'
        onClick={onUploadSelect}
        disabled={isUploading || disabled}
      >
        {isUploading ? 'Uploading...' : hasSnapshot ? 'Replace' : 'Upload'}
      </Button>

      <Button
        type='button'
        variant='secondary'
        size='sm'
        onClick={onInvalidate}
        disabled={isInvalidating || disabled}
      >
        {isInvalidating ? 'Invalidating...' : 'Invalidate Cache'}
      </Button>

      <Button
        type='button'
        variant='destructive'
        size='sm'
        onClick={onDelete}
        disabled={!hasSnapshot || isDeleting || disabled}
      >
        {isDeleting ? 'Deleting...' : 'Delete'}
      </Button>
    </div>
  )
}

function StaticSnapshotRow({
  row,
  actionsDisabled,
  isDeleting,
  isInvalidating,
  isUploading,
  onDelete,
  onInvalidate,
  onUpload,
  onUploadInputRef,
  onUploadSelect,
}: SortableSnapshotRowProps) {
  const hasSnapshot = Boolean(row.snapshot.minioKey)

  return (
    <TableRow>
      <TableCell className='font-medium'>
        <div className='flex items-center gap-2'>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='h-7 w-7 text-muted-foreground'
            disabled
            aria-label={`Reorder ${row.label}`}
          >
            <GripVertical className='h-4 w-4' />
          </Button>
          <span>{row.label}</span>
          {row.snapshot.sortOrder === 0 ? (
            <Badge variant='secondary'>Default</Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        {hasSnapshot ? (
          <Badge>Uploaded</Badge>
        ) : (
          <Badge variant='outline'>Not uploaded</Badge>
        )}
      </TableCell>
      <TableCell>{row.snapshot.queueId}</TableCell>
      <TableCell className='max-w-[260px] truncate font-mono text-xs'>
        {truncateMinioKey(row.snapshot.minioKey)}
      </TableCell>
      <TableCell>{getUploadDate(row.snapshot)}</TableCell>
      <TableCell>
        <SnapshotActions
          disabled={actionsDisabled}
          hasSnapshot={hasSnapshot}
          isDeleting={isDeleting}
          isInvalidating={isInvalidating}
          isUploading={isUploading}
          onDelete={onDelete}
          onInvalidate={onInvalidate}
          onUpload={onUpload}
          onUploadInputRef={onUploadInputRef}
          onUploadSelect={onUploadSelect}
        />
      </TableCell>
    </TableRow>
  )
}

function SortableSnapshotRow({
  row,
  actionsDisabled,
  dragDisabled,
  isDeleting,
  isInvalidating,
  isUploading,
  onDelete,
  onInvalidate,
  onUpload,
  onUploadInputRef,
  onUploadSelect,
}: SortableSnapshotRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: row.snapshot.id,
    disabled: dragDisabled,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const hasSnapshot = Boolean(row.snapshot.minioKey)

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={cn(
        isDragging && 'relative z-10 bg-muted/80 shadow-sm',
        !dragDisabled && 'transition-colors'
      )}
    >
      <TableCell className='font-medium'>
        <div className='flex items-center gap-2'>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='h-7 w-7 cursor-grab text-muted-foreground active:cursor-grabbing'
            disabled={dragDisabled}
            aria-label={`Reorder ${row.label}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className='h-4 w-4' />
          </Button>
          <span>{row.label}</span>
          {row.snapshot.sortOrder === 0 ? (
            <Badge variant='secondary'>Default</Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        {hasSnapshot ? (
          <Badge>Uploaded</Badge>
        ) : (
          <Badge variant='outline'>Not uploaded</Badge>
        )}
      </TableCell>
      <TableCell>{row.snapshot.queueId}</TableCell>
      <TableCell className='max-w-[260px] truncate font-mono text-xs'>
        {truncateMinioKey(row.snapshot.minioKey)}
      </TableCell>
      <TableCell>{getUploadDate(row.snapshot)}</TableCell>
      <TableCell>
        <SnapshotActions
          disabled={actionsDisabled}
          hasSnapshot={hasSnapshot}
          isDeleting={isDeleting}
          isInvalidating={isInvalidating}
          isUploading={isUploading}
          onDelete={onDelete}
          onInvalidate={onInvalidate}
          onUpload={onUpload}
          onUploadInputRef={onUploadInputRef}
          onUploadSelect={onUploadSelect}
        />
      </TableCell>
    </TableRow>
  )
}

export function SeasonDetailClient({
  season,
  snapshots,
}: {
  season: SeasonDetailPageData
  snapshots: SeasonSnapshotPageData[]
}) {
  const router = useRouter()
  const uploadInputsRef = useRef<Record<string, HTMLInputElement | null>>({})
  const [name, setName] = useState(season.name)
  const [startDate, setStartDate] = useState(() =>
    parseDateTimeValue(season.startDate)
  )
  const [endDate, setEndDate] = useState(() =>
    parseDateTimeValue(season.endDate)
  )
  const [isActive, setIsActive] = useState(season.isActive)
  const [formError, setFormError] = useState<string | null>(null)
  const [uploadingQueueType, setUploadingQueueType] = useState<string | null>(
    null
  )
  const [invalidatingQueueType, setInvalidatingQueueType] = useState<
    string | null
  >(null)
  const [deleteTarget, setDeleteTarget] = useState<SnapshotTableRow | null>(
    null
  )
  const [rows, setRows] = useState(() => buildSnapshotRows(snapshots))
  const [isHydrated, setIsHydrated] = useState(false)
  const [browserTimeZone, setBrowserTimeZone] = useState('UTC')
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  useEffect(() => {
    setRows(buildSnapshotRows(snapshots))
  }, [snapshots])

  useEffect(() => {
    setIsHydrated(true)
    setBrowserTimeZone(
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time'
    )
  }, [])

  const updateSeason = api.seasons.update.useMutation({
    onSuccess: () => {
      toast.success('Season updated')
      startTransition(() => {
        router.refresh()
      })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const uploadSnapshot = api.seasons.upload_snapshot.useMutation({
    onSuccess: () => {
      setUploadingQueueType(null)
      toast.success('Snapshot uploaded')
      startTransition(() => {
        router.refresh()
      })
    },
    onError: (error) => {
      setUploadingQueueType(null)
      toast.error(error.message)
    },
  })

  const invalidateCache = api.seasons.invalidate_cache.useMutation({
    onSuccess: () => {
      setInvalidatingQueueType(null)
      toast.success('Cache invalidated')
    },
    onError: (error) => {
      setInvalidatingQueueType(null)
      toast.error(error.message)
    },
  })

  const deleteSnapshot = api.seasons.delete_snapshot.useMutation({
    onSuccess: () => {
      setDeleteTarget(null)
      toast.success('Snapshot deleted')
      startTransition(() => {
        router.refresh()
      })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const reorderSnapshots = api.seasons.reorder_snapshots.useMutation()

  const sortableRows = rows.filter(isSortableSnapshotRow)
  const placeholderRows = rows.filter((row) => !isSortableSnapshotRow(row))

  function handleSeasonSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!name.trim()) {
      setFormError('Name required')
      return
    }

    if (!startDate) {
      setFormError('Start datetime required')
      return
    }

    setFormError(null)
    updateSeason.mutate({
      id: season.id,
      name: name.trim(),
      startDate,
      endDate,
      isActive,
    })
  }

  async function handleUpload(
    row: SnapshotTableRow,
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    if (!file.name.endsWith('.json')) {
      toast.error('Only .json files allowed')
      return
    }

    try {
      setUploadingQueueType(row.queueType)

      const text = await file.text()
      JSON.parse(text)

      const fileBytes = Array.from(new Uint8Array(await file.arrayBuffer()))

      uploadSnapshot.mutate({
        seasonId: season.id,
        queueType: row.queueType,
        queueId: row.snapshot?.queueId ?? row.queueId,
        fileName: file.name,
        contentType: file.type || 'application/json',
        buffer: fileBytes,
      })
    } catch {
      setUploadingQueueType(null)
      toast.error('Invalid JSON file')
    }
  }

  function handleInvalidate(row: SnapshotTableRow) {
    setInvalidatingQueueType(row.queueType)
    invalidateCache.mutate({
      seasonId: season.id,
      queueId: row.snapshot?.queueId ?? row.queueId,
    })
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) {
      return
    }

    deleteSnapshot.mutate({
      seasonId: season.id,
      queueType: deleteTarget.queueType,
    })
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event

    if (!over || active.id === over.id || reorderSnapshots.isPending) {
      return
    }

    const previousRows = rows
    const oldIndex = sortableRows.findIndex(
      (row) => row.snapshot.id === active.id
    )
    const newIndex = sortableRows.findIndex(
      (row) => row.snapshot.id === over.id
    )

    if (oldIndex < 0 || newIndex < 0) {
      return
    }

    const nextSortableRows = arrayMove(sortableRows, oldIndex, newIndex)
    const nextRows = [...nextSortableRows, ...placeholderRows]

    setRows(nextRows)

    try {
      await reorderSnapshots.mutateAsync({
        seasonId: season.id,
        snapshotIds: nextSortableRows.map((row) => row.snapshot.id),
      })

      toast.success('Snapshot order updated')
      startTransition(() => {
        router.refresh()
      })
    } catch (error) {
      setRows(previousRows)
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed updating snapshot order'
      )
    }
  }

  return (
    <div className='flex flex-col gap-6'>
      <TableShell className='p-4'>
        <form
          className='grid gap-4 md:grid-cols-2'
          onSubmit={handleSeasonSubmit}
        >
          <div className='grid gap-2'>
            <Label htmlFor='season-name'>Name</Label>
            <Input
              id='season-name'
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={updateSeason.isPending}
            />
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='season-active'>Active season</Label>
            <div className='flex min-h-9 items-center gap-3 rounded-md border px-3'>
              <Switch
                id='season-active'
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={updateSeason.isPending}
              />
              <span className='text-sm'>
                {isActive ? 'This season is active' : 'Inactive'}
              </span>
            </div>
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='season-start-date'>Start datetime</Label>
            <DateTimePicker
              id='season-start-date'
              value={startDate}
              onChange={setStartDate}
              placeholder='Pick start datetime'
              isHydrated={isHydrated}
              timeZone={browserTimeZone}
              disabled={updateSeason.isPending}
            />
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='season-end-date'>End datetime</Label>
            <DateTimePicker
              id='season-end-date'
              value={endDate}
              onChange={setEndDate}
              placeholder='Optional end datetime'
              clearable
              isHydrated={isHydrated}
              timeZone={browserTimeZone}
              disabled={updateSeason.isPending}
            />
          </div>

          <div className='rounded-md border border-dashed bg-muted/30 px-3 py-2 md:col-span-2'>
            <p className='text-muted-foreground text-xs'>
              Season datetimes use your browser timezone:{' '}
              <span className='font-medium text-foreground'>
                {isHydrated ? browserTimeZone : 'detecting...'}
              </span>
              . Each picker also shows the UTC timestamp that will be saved.
            </p>
          </div>

          <div className='md:col-span-2'>
            <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
              <div className='flex items-center gap-2'>
                <Badge variant={isActive ? 'default' : 'outline'}>
                  {isActive ? 'Active' : 'Inactive'}
                </Badge>
                <span className='text-muted-foreground text-sm'>
                  Season #{season.id}
                </span>
              </div>

              <Button type='submit' disabled={updateSeason.isPending}>
                {updateSeason.isPending ? 'Saving...' : 'Save Season'}
              </Button>
            </div>

            {formError ? (
              <p className='pt-3 text-destructive text-sm'>{formError}</p>
            ) : null}
          </div>
        </form>
      </TableShell>

      <TableShell className='overflow-hidden'>
        <div className='border-b px-4 py-3'>
          <h2 className='font-semibold text-lg'>Snapshots</h2>
          <p className='text-muted-foreground text-sm'>
            Drag rows to set leaderboard tab order and default leaderboard. The
            first row is the default. Upload season-end leaderboard JSON,
            invalidate cache, or remove a stored snapshot.
          </p>
        </div>

        {isHydrated ? (
          <DndContext
            id={`season-snapshots-${season.id}`}
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <Table>
              <TableHeader className='bg-muted/50'>
                <TableRow>
                  <TableHead>Queue</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Queue ID</TableHead>
                  <TableHead>MinIO key</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <SortableContext
                  items={sortableRows.map((row) => row.snapshot.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {sortableRows.map((row) => {
                    const isUploading = uploadingQueueType === row.queueType
                    const isInvalidating =
                      invalidatingQueueType === row.queueType
                    const isDeleting =
                      deleteSnapshot.isPending &&
                      deleteTarget?.queueType === row.queueType

                    return (
                      <SortableSnapshotRow
                        key={row.queueType}
                        row={row}
                        actionsDisabled={reorderSnapshots.isPending}
                        dragDisabled={
                          reorderSnapshots.isPending || sortableRows.length < 2
                        }
                        isUploading={isUploading}
                        isInvalidating={isInvalidating}
                        isDeleting={isDeleting}
                        onUpload={(event) => handleUpload(row, event)}
                        onUploadInputRef={(node) => {
                          uploadInputsRef.current[row.queueType] = node
                        }}
                        onUploadSelect={() =>
                          uploadInputsRef.current[row.queueType]?.click()
                        }
                        onInvalidate={() => handleInvalidate(row)}
                        onDelete={() => setDeleteTarget(row)}
                      />
                    )
                  })}
                </SortableContext>

                {placeholderRows.map((row) => {
                  const hasSnapshot = Boolean(row.snapshot?.minioKey)
                  const isUploading = uploadingQueueType === row.queueType
                  const isInvalidating = invalidatingQueueType === row.queueType
                  const isDeleting =
                    deleteSnapshot.isPending &&
                    deleteTarget?.queueType === row.queueType

                  return (
                    <TableRow key={row.queueType}>
                      <TableCell className='font-medium'>{row.label}</TableCell>
                      <TableCell>
                        {hasSnapshot ? (
                          <Badge>Uploaded</Badge>
                        ) : (
                          <Badge variant='outline'>Not uploaded</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.snapshot?.queueId ?? row.queueId}
                      </TableCell>
                      <TableCell className='max-w-[260px] truncate font-mono text-xs'>
                        {truncateMinioKey(row.snapshot?.minioKey ?? null)}
                      </TableCell>
                      <TableCell>{getUploadDate(row.snapshot)}</TableCell>
                      <TableCell>
                        <div className='flex flex-wrap gap-2'>
                          <input
                            ref={(node) => {
                              uploadInputsRef.current[row.queueType] = node
                            }}
                            type='file'
                            accept='.json,application/json'
                            className='hidden'
                            onChange={(event) => handleUpload(row, event)}
                          />

                          <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            onClick={() =>
                              uploadInputsRef.current[row.queueType]?.click()
                            }
                            disabled={isUploading || reorderSnapshots.isPending}
                          >
                            {isUploading
                              ? 'Uploading...'
                              : hasSnapshot
                                ? 'Replace'
                                : 'Upload'}
                          </Button>

                          <Button
                            type='button'
                            variant='secondary'
                            size='sm'
                            onClick={() => handleInvalidate(row)}
                            disabled={
                              isInvalidating || reorderSnapshots.isPending
                            }
                          >
                            {isInvalidating
                              ? 'Invalidating...'
                              : 'Invalidate Cache'}
                          </Button>

                          <Button
                            type='button'
                            variant='destructive'
                            size='sm'
                            onClick={() => setDeleteTarget(row)}
                            disabled={
                              !hasSnapshot ||
                              isDeleting ||
                              reorderSnapshots.isPending
                            }
                          >
                            {isDeleting ? 'Deleting...' : 'Delete'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </DndContext>
        ) : (
          <Table>
            <TableHeader className='bg-muted/50'>
              <TableRow>
                <TableHead>Queue</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Queue ID</TableHead>
                <TableHead>MinIO key</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortableRows.map((row) => {
                const isUploading = uploadingQueueType === row.queueType
                const isInvalidating = invalidatingQueueType === row.queueType
                const isDeleting =
                  deleteSnapshot.isPending &&
                  deleteTarget?.queueType === row.queueType

                return (
                  <StaticSnapshotRow
                    key={row.queueType}
                    row={row}
                    actionsDisabled={reorderSnapshots.isPending}
                    dragDisabled
                    isUploading={isUploading}
                    isInvalidating={isInvalidating}
                    isDeleting={isDeleting}
                    onUpload={(event) => handleUpload(row, event)}
                    onUploadInputRef={(node) => {
                      uploadInputsRef.current[row.queueType] = node
                    }}
                    onUploadSelect={() =>
                      uploadInputsRef.current[row.queueType]?.click()
                    }
                    onInvalidate={() => handleInvalidate(row)}
                    onDelete={() => setDeleteTarget(row)}
                  />
                )
              })}
              {placeholderRows.map((row) => {
                const hasSnapshot = Boolean(row.snapshot?.minioKey)
                const isUploading = uploadingQueueType === row.queueType
                const isInvalidating = invalidatingQueueType === row.queueType
                const isDeleting =
                  deleteSnapshot.isPending &&
                  deleteTarget?.queueType === row.queueType

                return (
                  <TableRow key={row.queueType}>
                    <TableCell className='font-medium'>{row.label}</TableCell>
                    <TableCell>
                      {hasSnapshot ? (
                        <Badge>Uploaded</Badge>
                      ) : (
                        <Badge variant='outline'>Not uploaded</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.snapshot?.queueId ?? row.queueId}
                    </TableCell>
                    <TableCell className='max-w-[260px] truncate font-mono text-xs'>
                      {truncateMinioKey(row.snapshot?.minioKey ?? null)}
                    </TableCell>
                    <TableCell>{getUploadDate(row.snapshot)}</TableCell>
                    <TableCell>
                      <div className='flex flex-wrap gap-2'>
                        <input
                          ref={(node) => {
                            uploadInputsRef.current[row.queueType] = node
                          }}
                          type='file'
                          accept='.json,application/json'
                          className='hidden'
                          onChange={(event) => handleUpload(row, event)}
                        />

                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          onClick={() =>
                            uploadInputsRef.current[row.queueType]?.click()
                          }
                          disabled={isUploading || reorderSnapshots.isPending}
                        >
                          {isUploading
                            ? 'Uploading...'
                            : hasSnapshot
                              ? 'Replace'
                              : 'Upload'}
                        </Button>

                        <Button
                          type='button'
                          variant='secondary'
                          size='sm'
                          onClick={() => handleInvalidate(row)}
                          disabled={
                            isInvalidating || reorderSnapshots.isPending
                          }
                        >
                          {isInvalidating
                            ? 'Invalidating...'
                            : 'Invalidate Cache'}
                        </Button>

                        <Button
                          type='button'
                          variant='destructive'
                          size='sm'
                          onClick={() => setDeleteTarget(row)}
                          disabled={
                            !hasSnapshot ||
                            isDeleting ||
                            reorderSnapshots.isPending
                          }
                        >
                          {isDeleting ? 'Deleting...' : 'Delete'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </TableShell>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `This removes the stored JSON for ${deleteTarget.label} and clears its cached leaderboard.`
                : 'This removes the stored snapshot.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSnapshot.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteSnapshot.isPending}
            >
              {deleteSnapshot.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
