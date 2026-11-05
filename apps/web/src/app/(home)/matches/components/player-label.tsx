import Link from 'next/link'

export function PlayerLabel({
  playerId,
  displayName,
  viewerId,
  href,
}: {
  playerId: string
  displayName?: string
  viewerId: string | null
  /** Staff: the player's page. Opens in the same tab. */
  href?: string
}) {
  const name = displayName ?? playerId.slice(0, 8)
  if (href) {
    return (
      <Link href={href} className='font-medium text-bal-blue hover:underline'>
        {name}
      </Link>
    )
  }
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
