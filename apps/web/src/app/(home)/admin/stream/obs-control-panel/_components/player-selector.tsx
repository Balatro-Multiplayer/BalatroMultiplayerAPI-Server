'use client'

import { Check, ChevronsUpDown } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

type PlayerSelectorProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  onValueChange: (value: string) => void
  players: Array<{ label: string; value: string }>
}

function PlayerSelectorRaw({
  open,
  onOpenChange,
  value,
  players,
  onValueChange,
}: PlayerSelectorProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          role='combobox'
          aria-expanded={open}
          className='w-[200px] justify-between'
        >
          {value
            ? players.find((player) => player.value === value)?.label
            : 'Select player...'}
          <ChevronsUpDown className='opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[200px] p-0'>
        <Command
          filter={(value, search, keywords) => {
            if (value.toLowerCase().includes(search.toLowerCase())) return 1
            const name = keywords?.[0]
            if (name?.toLowerCase().includes(search.toLowerCase())) return 1
            return 0
          }}
        >
          <CommandInput placeholder='Search players...' className='h-9' />
          <CommandList>
            <CommandEmpty>No players found.</CommandEmpty>
            <CommandGroup>
              {players.map((player) => (
                <CommandItem
                  key={`${player.value}-2`}
                  value={player.value}
                  keywords={[player.label]}
                  onSelect={(currentValue) => {
                    onValueChange(currentValue === value ? '' : currentValue)
                    onOpenChange(false)
                  }}
                >
                  {player.label}
                  <Check
                    className={cn(
                      'ml-auto',
                      value === player.value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export const PlayerSelector = React.memo(PlayerSelectorRaw)
