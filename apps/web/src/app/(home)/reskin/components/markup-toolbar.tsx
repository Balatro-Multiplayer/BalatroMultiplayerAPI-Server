'use client'

import { Hash, Palette, RotateCcw, Sparkles, Square, Type } from 'lucide-react'
import { type RefObject, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { BOX_NAMES, COLOR_NAMES, COLORS, resolveColor } from '../lib/balatroMarkup'
import type { EditorHandle } from './markup-editor'

// Display names for colour keys whose game name is unintuitive.
const NAME_LABELS: Record<string, string> = { dark_edition: 'negative' }
const nameLabel = (n: string) => NAME_LABELS[n] ?? n

export function MarkupToolbar({ editor }: { editor: RefObject<EditorHandle | null> }) {
  const [varN, setVarN] = useState('1')
  const ed = () => editor.current

  return (
    <div className='flex flex-wrap items-center gap-1 rounded-md border bg-muted/40 p-1'>
      {/* text colour */}
      <Popover>
        <PopoverTrigger asChild>
          <Button type='button' size='sm' variant='ghost' className='h-7 gap-1 px-2'>
            <Palette className='size-3.5' /> Colour
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-56'>
          <div className='grid grid-cols-5 gap-1'>
            {COLOR_NAMES.map((name) => (
              <button
                key={name}
                type='button'
                title={nameLabel(name)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => ed()?.apply('C', name)}
                className='size-8 rounded border'
                style={{ backgroundColor: resolveColor(name) }}
              />
            ))}
          </div>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            className='mt-2 w-full'
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => ed()?.apply('C', null)}
          >
            Remove colour
          </Button>
        </PopoverContent>
      </Popover>

      {/* box (X) */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type='button' size='sm' variant='ghost' className='h-7 gap-1 px-2'>
            <Square className='size-3.5' /> Box
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {BOX_NAMES.map((name) => (
            <DropdownMenuItem
              key={name}
              onSelect={() => ed()?.apply('X', name)}
              className='gap-2'
            >
              <span
                className='inline-block size-4 rounded'
                style={{ backgroundColor: COLORS[name] }}
              />
              {nameLabel(name)}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => ed()?.apply('X', null)}>
            Remove box
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* scale (s) */}
      <Popover>
        <PopoverTrigger asChild>
          <Button type='button' size='sm' variant='ghost' className='h-7 gap-1 px-2'>
            <Type className='size-3.5' /> Scale
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-40'>
          <div className='flex flex-wrap gap-1'>
            {['0.8', '1', '1.2', '1.5', '2'].map((s) => (
              <Button
                key={s}
                type='button'
                size='sm'
                variant='outline'
                className='h-7 px-2'
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => ed()?.apply('s', s === '1' ? null : s)}
              >
                {s}×
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* effect (E) */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type='button' size='sm' variant='ghost' className='h-7 gap-1 px-2'>
            <Sparkles className='size-3.5' /> Effect
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => ed()?.apply('E', '1')}>
            Float (E:1)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => ed()?.apply('E', '2')}>
            Bump (E:2)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => ed()?.apply('E', null)}>
            None
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* variable (#n#) */}
      <Popover>
        <PopoverTrigger asChild>
          <Button type='button' size='sm' variant='ghost' className='h-7 gap-1 px-2'>
            <Hash className='size-3.5' /> Variable
          </Button>
        </PopoverTrigger>
        <PopoverContent className='flex w-40 items-center gap-2'>
          <Input
            value={varN}
            onChange={(e) => setVarN(e.target.value.replace(/[^0-9]/g, '') || '1')}
            className='h-8 w-14'
          />
          <Button
            type='button'
            size='sm'
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => ed()?.insertVar(varN)}
          >
            Insert #{varN}#
          </Button>
        </PopoverContent>
      </Popover>

      <div className='flex-1' />
      <Button
        type='button'
        size='sm'
        variant='ghost'
        className='h-7 gap-1 px-2 text-muted-foreground'
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => ed()?.reset()}
        title='Clear formatting on the selection'
      >
        <RotateCcw className='size-3.5' /> Clear
      </Button>
    </div>
  )
}
