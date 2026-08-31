export function PlayerLabel({
  playerId,
  viewerId,
}: {
  playerId: string
  viewerId: string | null
}) {
  if (viewerId && playerId === viewerId) {
    return <span className='font-medium'>You</span>
  }
  return (
    <span className='font-mono text-muted-foreground text-xs'>
      {playerId.slice(0, 8)}
    </span>
  )
}
