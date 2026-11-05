import { redirect } from 'next/navigation'

// Staff roles moved to the player page. The Players list can show staff only.
export default function AdminUsersPage() {
  redirect('/admin/players')
}
