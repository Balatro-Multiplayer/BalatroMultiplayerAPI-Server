// Which item the focus view opens after the open one is skipped or closed.
// The rail is already in priority order and leaves out items other staff
// claimed, so the next item is the first open one that is not the current one.
export function nextItemId(
  items: readonly { id: number; status: string }[],
  currentId: number | null
): number | null {
  return (
    items.find((i) => i.status === 'open' && i.id !== currentId)?.id ?? null
  )
}
