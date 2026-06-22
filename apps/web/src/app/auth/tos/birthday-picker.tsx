'use client'

import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { computeAge } from './compute-age'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1)
const currentYear = new Date().getFullYear()
const YEARS = Array.from({ length: 121 }, (_, i) => currentYear - i)

interface BirthdayPickerProps {
  onAgeChange: (age: number | null) => void
}

export function BirthdayPicker({ onAgeChange }: BirthdayPickerProps) {
  const [month, setMonth] = useState<number | null>(null)
  const [day, setDay] = useState<number | null>(null)
  const [year, setYear] = useState<number | null>(null)

  function handleChange(m: number | null, d: number | null, y: number | null) {
    if (m !== null && d !== null && y !== null) {
      onAgeChange(computeAge(m, d, y))
    } else {
      onAgeChange(null)
    }
  }

  return (
    <div className='space-y-2'>
      <p className='text-sm font-medium'>Your birthday</p>
      <p className='text-xs text-muted-foreground'>
        We won&apos;t store it, we just need to check that you are old enough to play.
      </p>
      <div className='grid grid-cols-3 gap-2'>
        <div className='space-y-1'>
          <Label className='text-xs'>Month</Label>
          <Select
            onValueChange={(v) => {
              const m = Number(v)
              setMonth(m)
              handleChange(m, day, year)
            }}
          >
            <SelectTrigger><SelectValue placeholder='Month' /></SelectTrigger>
            <SelectContent>
              {MONTHS.map((name, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1'>
          <Label className='text-xs'>Day</Label>
          <Select
            onValueChange={(v) => {
              const d = Number(v)
              setDay(d)
              handleChange(month, d, year)
            }}
          >
            <SelectTrigger><SelectValue placeholder='Day' /></SelectTrigger>
            <SelectContent>
              {DAYS.map((d) => (
                <SelectItem key={d} value={String(d)}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1'>
          <Label className='text-xs'>Year</Label>
          <Select
            onValueChange={(v) => {
              const y = Number(v)
              setYear(y)
              handleChange(month, day, y)
            }}
          >
            <SelectTrigger><SelectValue placeholder='Year' /></SelectTrigger>
            <SelectContent>
              {YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
