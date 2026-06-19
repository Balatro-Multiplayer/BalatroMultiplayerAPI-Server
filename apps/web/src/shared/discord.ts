export const DISCORD_SNOWFLAKE_REGEX = /^\d{17,20}$/
export const DISCORD_CUSTOM_EMOJI_REGEX =
  /^<(a?):([a-zA-Z0-9_]{2,32}):(\d{17,20})>$/

export const isDiscordSnowflake = (value: string) =>
  DISCORD_SNOWFLAKE_REGEX.test(value)

export function parseDiscordCustomEmoji(
  value: string
): { animated: boolean; id: string; name: string } | null {
  const match = DISCORD_CUSTOM_EMOJI_REGEX.exec(value.trim())
  if (!match) return null

  const [, animatedFlag = '', name = '', id = ''] = match
  if (!name || !id) return null

  return {
    animated: animatedFlag === 'a',
    id,
    name,
  }
}

export function getDiscordCustomEmojiUrl(value: string) {
  const emoji = parseDiscordCustomEmoji(value)
  if (!emoji) return null

  return `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'webp'}?size=64&quality=lossless`
}
