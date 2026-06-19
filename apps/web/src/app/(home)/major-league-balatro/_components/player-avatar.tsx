import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

interface PlayerAvatarProps {
  playerName: string
  img?: string
  className?: string
}

export function PlayerAvatar({
  playerName,
  img,
  className,
}: PlayerAvatarProps) {
  const initials = getInitials(playerName)
  return (
    <Avatar className={className}>
      <AvatarImage src={img} alt={playerName} />
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
  )
}

function getInitials(name: string) {
  if (!name || name === 'TBD') return '?'

  const parts = name.split(' ')
  if (parts.length === 1) return name.substring(0, 2).toUpperCase()
  return (
    (parts?.[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')
  ).toUpperCase()
}
