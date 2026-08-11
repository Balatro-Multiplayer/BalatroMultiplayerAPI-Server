import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

// Ported from www's InfoTooltipLabel (log-parser/page.tsx).
export function InfoTooltipLabel({
  label,
  description,
}: {
  label: string
  description: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='cursor-help border-muted-foreground border-b border-dashed'>
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className='max-w-xs whitespace-pre-line'>
        <p>{description}</p>
      </TooltipContent>
    </Tooltip>
  )
}
