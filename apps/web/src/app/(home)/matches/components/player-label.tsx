export function PlayerLabel({
  playerId,
  displayName,
  viewerId,
}: {
  playerId: string
  displayName?: string
  viewerId: string | null
}) {
  const name = displayName ?? playerId.slice(0, 8)
  if (viewerId && playerId === viewerId) {
    return (
      <span className='font-medium'>
        {name} <span className='text-muted-foreground text-xs'>(you)</span>
      </span>
    )
  }
  return displayName ? (
    <span className='font-medium'>{name}</span>
  ) : (
    <span className='font-mono text-muted-foreground text-xs'>{name}</span>
  )
}
