import { redirect } from 'next/navigation'

// Match History is gone: staff use the match list.
export default function AdminGamesPage() {
  redirect('/matches')
}
