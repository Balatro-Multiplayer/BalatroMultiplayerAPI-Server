'use client'

import { format } from 'date-fns'
import { ChevronDownIcon, X } from 'lucide-react'
import { type ChangeEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

type DateTimePickerProps = {
  id?: string
  value: Date | null
  onChange: (value: Date | null) => void
  disabled?: boolean
  placeholder: string
  clearable?: boolean
  isHydrated: boolean
  timeZone: string
}

const CALENDAR_FROM_YEAR = 2000
const CALENDAR_TO_YEAR = 2100

function formatUtcOffset(date: Date) {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absoluteMinutes = Math.abs(offsetMinutes)
  const hours = Math.floor(absoluteMinutes / 60)
  const minutes = absoluteMinutes % 60

  return `UTC${sign}${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}`
}

function buildDateWithTime(datePart: Date, currentValue: Date | null) {
  const nextValue = new Date(datePart)

  if (currentValue) {
    nextValue.setHours(currentValue.getHours(), currentValue.getMinutes(), 0, 0)
    return nextValue
  }

  nextValue.setHours(0, 0, 0, 0)
  return nextValue
}

function formatDatePreview(date: Date) {
  return format(date, 'PPP')
}

function formatUtcPreview(date: Date) {
  return date.toISOString()
}

function formatTimeValue(date: Date | null) {
  if (!date) {
    return '00:00:00'
  }

  return format(date, 'HH:mm:ss')
}

function updateTimeValue(
  currentValue: Date | null,
  event: ChangeEvent<HTMLInputElement>
) {
  if (!currentValue) {
    return null
  }

  const [hours = '0', minutes = '0', seconds = '0'] =
    event.target.value.split(':')
  const nextValue = new Date(currentValue)

  nextValue.setHours(
    Number.parseInt(hours, 10),
    Number.parseInt(minutes, 10),
    Number.parseInt(seconds, 10),
    0
  )

  return nextValue
}

export function DateTimePicker({
  id,
  value,
  onChange,
  disabled,
  placeholder,
  clearable = false,
  isHydrated,
  timeZone,
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false)

  const timeZoneLabel = isHydrated
    ? `${timeZone} (${formatUtcOffset(value ?? new Date())})`
    : 'Detecting local timezone...'

  const dateLabel = value
    ? isHydrated
      ? formatDatePreview(value)
      : formatUtcPreview(value)
    : placeholder

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className='grid gap-2'>
        <div className='flex flex-col gap-2 sm:flex-row'>
          <PopoverTrigger asChild>
            <Button
              id={id}
              type='button'
              variant='outline'
              disabled={disabled}
              className='w-full justify-between font-normal sm:flex-1'
            >
              <span
                className={cn('truncate', !value && 'text-muted-foreground')}
              >
                {dateLabel}
              </span>
              <ChevronDownIcon className='size-4 opacity-70' />
            </Button>
          </PopoverTrigger>

          <div className='flex gap-2 sm:w-[11rem]'>
            <Input
              type='time'
              step='1'
              value={formatTimeValue(value)}
              onChange={(event) => {
                const nextValue = updateTimeValue(value, event)

                if (nextValue) {
                  onChange(nextValue)
                }
              }}
              disabled={disabled || !value}
              className='appearance-none bg-background [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none'
            />

            {clearable ? (
              <Button
                type='button'
                variant='ghost'
                size='icon'
                onClick={() => onChange(null)}
                disabled={disabled || !value}
                aria-label='Clear datetime'
              >
                <X className='size-4' />
              </Button>
            ) : null}
          </div>
        </div>

        <p className='text-muted-foreground text-xs'>
          {isHydrated
            ? `Shown in ${timeZoneLabel}. Saved as ${value ? formatUtcPreview(value) : 'unset'}.`
            : 'Local timezone loads after hydration. UTC value shown until then.'}
        </p>
      </div>

      <PopoverContent className='w-auto overflow-hidden p-0' align='start'>
        <Calendar
          mode='single'
          selected={value ?? undefined}
          captionLayout='dropdown'
          fromYear={CALENDAR_FROM_YEAR}
          toYear={CALENDAR_TO_YEAR}
          defaultMonth={value ?? new Date()}
          onSelect={(nextDate) => {
            if (!nextDate) {
              return
            }

            onChange(buildDateWithTime(nextDate, value))
            setOpen(false)
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  )
}
