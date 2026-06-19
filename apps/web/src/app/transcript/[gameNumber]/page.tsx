import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { auth } from '@/server/auth'
import { createMetadata } from '../../../../lib/metadata'

type Props = {
  params: Promise<{
    gameNumber: string
  }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const gameNumber = Number.parseInt((await params).gameNumber, 10)
  return createMetadata({
    title: `Game Transcript #${gameNumber}`,
    description: `Internal transcript view for game #${gameNumber}.`,
    path: `/transcript/${gameNumber}`,
    noIndex: true,
  })
}

export default async function TranscriptPage({ params }: Props) {
  const session = await auth()

  if (!hasPermission(session?.user, 'transcripts.view')) {
    redirect('/api/auth/signin')
  }

  const gameNumber = Number.parseInt((await params).gameNumber, 10)

  return (
    <iframe
      src={`/api/transcript/${gameNumber}`}
      className='h-screen w-screen border-none'
      title={`Game Transcript #${gameNumber}`}
    />
  )
}
