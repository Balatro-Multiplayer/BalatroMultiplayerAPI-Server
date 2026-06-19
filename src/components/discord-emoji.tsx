import Image from 'next/image'
import { cn } from '@/lib/utils'
import {
  getDiscordCustomEmojiUrl,
  parseDiscordCustomEmoji,
} from '@/shared/discord'

type DiscordEmojiProps = {
  value: string
  className?: string
}

export function DiscordEmoji({ value, className }: DiscordEmojiProps) {
  const parsed = parseDiscordCustomEmoji(value)
  const url = getDiscordCustomEmojiUrl(value)

  if (!parsed || !url) {
    return <span className={className}>{value}</span>
  }

  return (
    <Image
      src={url}
      alt={parsed.name}
      width={20}
      height={20}
      unoptimized
      title={parsed.name}
      className={cn('inline-block shrink-0 object-contain', className)}
    />
  )
}
