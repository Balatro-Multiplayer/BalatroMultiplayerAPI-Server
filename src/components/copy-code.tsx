'use client'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface CopyCodeProps {
  children: React.ReactNode
}

export function CopyCode({ children }: CopyCodeProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      const content = children?.toString() || ''
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <span className='relative inline-flex items-center'>
      <code className='pr-6'>{children}</code>
      <Button
        variant='ghost'
        size='icon'
        className='absolute right-0 h-5 w-5 p-0.5'
        onClick={handleCopy}
      >
        {copied ? <Check className='h-3 w-3' /> : <Copy className='h-3 w-3' />}
      </Button>
    </span>
  )
}
