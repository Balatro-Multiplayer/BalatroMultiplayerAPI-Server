import { isPlainRecord } from '../lib/plain-record'

function isSimpleValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    ['string', 'number', 'boolean'].includes(typeof value)
  )
}

export function ArgsView({ args }: { args: unknown }) {
  if (args === null || args === undefined) {
    return <span className='text-muted-foreground'>—</span>
  }

  if (isSimpleValue(args)) {
    return <span className='font-mono text-xs'>{String(args)}</span>
  }

  if (isPlainRecord(args) && Object.values(args).every(isSimpleValue)) {
    return (
      <span className='flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs'>
        {Object.entries(args).map(([key, value]) => (
          <span key={key}>
            <span className='text-muted-foreground'>{key}:</span>{' '}
            {String(value)}
          </span>
        ))}
      </span>
    )
  }

  return (
    <details className='text-xs'>
      <summary className='cursor-pointer text-muted-foreground'>view</summary>
      <pre className='mt-1 max-w-md overflow-x-auto rounded bg-muted p-2'>
        {JSON.stringify(args, null, 2)}
      </pre>
    </details>
  )
}
