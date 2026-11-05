import { redirect } from 'next/navigation'

// An item's own URL opens it in the queue's investigation panel.
export default async function ServiceQueueItemPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const itemId = Number.parseInt(id, 10)
  redirect(
    Number.isInteger(itemId) && itemId > 0
      ? `/admin/service-queue?item=${itemId}`
      : '/admin/service-queue'
  )
}
