'use client'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function Standings() {
  const [showResults, setShowResults] = useState(false)
  return (
    <section id='results' className='container py-8 md:py-12'>
      <div className='mx-auto flex max-w-[58rem] flex-col items-center space-y-4 text-center'>
        <h2 className='font-bold text-3xl leading-tight tracking-tighter md:text-4xl'>
          Tournament Standings
        </h2>
        <p className='max-w-[85%] text-muted-foreground leading-normal sm:text-lg sm:leading-7'>
          Current standings after Week 1
        </p>

        <Button
          variant='outline'
          onClick={() => setShowResults(!showResults)}
          className='mt-4'
        >
          {showResults ? (
            <>
              <EyeOff className='mr-2 h-4 w-4' />
              Hide Results
            </>
          ) : (
            <>
              <Eye className='mr-2 h-4 w-4' />
              Show Results
            </>
          )}
        </Button>
      </div>
    </section>
  )
}
