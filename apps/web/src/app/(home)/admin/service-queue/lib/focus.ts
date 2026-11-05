// Which item the focus view opens after the open one is skipped or closed.
// The rail is already in priority order and leaves out items other staff
// claimed, so the next item is the first open one that is not the current one
// and not one whose action is still waiting to be sent.
export function nextItemId(
  items: readonly { id: number; status: string }[],
  currentId: number | null,
  waitingIds: readonly number[] = []
): number | null {
  return (
    items.find(
      (i) =>
        i.status === 'open' && i.id !== currentId && !waitingIds.includes(i.id)
    )?.id ?? null
  )
}
