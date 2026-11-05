'use client'

import Link from 'next/link'
import { type ComponentProps, createContext, useContext } from 'react'
import { keepClaim } from '../lib/claim-keep'
import { matchHref, playerHref } from '../lib/links'

// The queue item on screen. Player and match links inside it carry the item
// (`?item=<id>`), open in the same tab and leave the item's claim in place.
const ItemContext = createContext<number | null>(null)
export const ItemProvider = ItemContext.Provider

export function ItemLink({
  to,
  onClick,
  ...rest
}: { to: { player: string } | { match: string } } & Omit<
  ComponentProps<typeof Link>,
  'href'
>) {
  const itemId = useContext(ItemContext)
  const href =
    'player' in to ? playerHref(to.player, itemId) : matchHref(to.match, itemId)
  return (
    <Link
      {...rest}
      href={href}
      onClick={(e) => {
        if (itemId !== null) keepClaim(itemId)
        onClick?.(e)
      }}
    />
  )
}
