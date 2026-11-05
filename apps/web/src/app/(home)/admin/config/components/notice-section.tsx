import { SectionFrame } from './section-frame'

export function NoticeSection({
  version,
  date,
}: {
  version: number
  date: string
}) {
  return (
    <SectionFrame
      testId='config-notice'
      title='Notice'
      description='Read only. The notice is set in code (packages/types/src/notice.ts). A deploy with a higher version asks every player to accept again.'
    >
      <p className='text-sm'>
        Version {version}, dated {date}
      </p>
    </SectionFrame>
  )
}
