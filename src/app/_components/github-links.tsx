'use client'

import { ExternalLink } from 'lucide-react'
import type { PropsWithChildren } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'

const WEB_GITHUB_REPO_URL = 'https://github.com/Balatro-Multiplayer/www'
const MOD_GITHUB_REPO_URL =
  'https://github.com/Balatro-Multiplayer/BalatroMultiplayer'

export function GithubLinks({ children }: PropsWithChildren) {
  return (
    <DropdownMenu>
      {/*Dropdown trigger*/}
      {children}
      <DropdownMenuContent>
        <DropdownMenuItem asChild>
          <a
            href={MOD_GITHUB_REPO_URL}
            rel={'noreferrer'}
            target={'_blank'}
            className={'!gap-1 flex items-start'}
          >
            Multiplayer Mod
            <ExternalLink className={'mt-0.5 size-3'} />
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href={WEB_GITHUB_REPO_URL}
            rel={'noreferrer'}
            target={'_blank'}
            className={'!gap-1 mt-0.5 flex items-start'}
          >
            BalatroMP Website
            <ExternalLink className={'size-3'} />
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
