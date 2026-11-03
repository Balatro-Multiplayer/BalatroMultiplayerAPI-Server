import { redirect } from 'next/navigation'

export default async function MatchLogRedirect({
  params,
}: {
  params: Promise<{ runId: string }>
}) {
  const { runId } = await params
  redirect(`/matches/${runId}`)
}
