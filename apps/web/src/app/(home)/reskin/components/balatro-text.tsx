'use client'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  type Atom,
  groupRuns,
  parseMarkup,
  resolveColor,
  type Run,
  type Style,
} from '../lib/balatroMarkup'

/** Faithful read-only render of Balatro markup, on a light card-like surface. */
export function BalatroText({
  lines,
  className,
}: {
  lines: string[]
  className?: string
}) {
  const doc = parseMarkup(lines.length ? lines : [''])
  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={cn(
          'min-h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-center font-medium text-[13px] leading-tight shadow-xs dark:bg-input/30',
          className
        )}
      >
        {doc.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
          <div key={i} className='whitespace-pre-wrap break-words'>
            {line.length === 0 ? (
              <span className='opacity-40'>&nbsp;</span>
            ) : (
              groupRuns(line).map((run, j) => <RunView key={j} run={run} />)
            )}
          </div>
        ))}
      </div>
    </TooltipProvider>
  )
}

function effectClass(style: Style): string {
  if (style.E === '1') return 'bal-e1'
  if (style.E === '2') return 'bal-e2'
  return ''
}

function RunView({ run }: { run: Run }) {
  const { style } = run
  const scale = style.s ? Number(style.s) : 1
  const content = <RunAtoms atoms={run.atoms} />

  let body: React.ReactNode
  if (style.X) {
    // multiplier / chip box: filled rounded background, text colour from C
    body = (
      <span
        className={cn('mx-[1px] inline-block rounded px-1', effectClass(style))}
        style={{
          backgroundColor: resolveColor(style.X),
          color: style.C ? resolveColor(style.C) : '#FFFFFF',
          fontSize: scale !== 1 ? `${scale}em` : undefined,
        }}
      >
        {content}
      </span>
    )
  } else {
    body = (
      <span
        className={effectClass(style)}
        style={{
          color: style.C ? resolveColor(style.C) : undefined,
          fontSize: scale !== 1 ? `${scale}em` : undefined,
        }}
      >
        {content}
      </span>
    )
  }

  if (style.T) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='cursor-help underline decoration-dotted underline-offset-2'>
            {body}
          </span>
        </TooltipTrigger>
        <TooltipContent>Tooltip: {style.T}</TooltipContent>
      </Tooltip>
    )
  }
  return body
}

/** Render a run's atoms: text segments inline, variable slots as chips. */
function RunAtoms({ atoms }: { atoms: Atom[] }) {
  const out: React.ReactNode[] = []
  let buffer = ''
  const flush = (key: number) => {
    if (buffer) {
      out.push(<span key={`t${key}`}>{buffer}</span>)
      buffer = ''
    }
  }
  atoms.forEach((a, i) => {
    if (a.kind === 'char') {
      buffer += a.ch
    } else {
      flush(i)
      out.push(
        <span
          key={`v${i}`}
          className='mx-[1px] inline-block rounded-sm bg-black/15 px-1 text-[0.85em] tabular-nums'
          title={`Variable #${a.n}# (filled in-game)`}
        >
          #{a.n}#
        </span>
      )
    }
  })
  flush(atoms.length)
  return <>{out}</>
}
