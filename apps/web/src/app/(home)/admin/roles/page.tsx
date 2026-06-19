import { redirect } from 'next/navigation'
import { createMetadata } from '../../../../../lib/metadata'

export const metadata = createMetadata({
  title: 'Roles Redirect',
  description: 'Legacy redirect to the permissions manager.',
  path: '/admin/roles',
  noIndex: true,
})

export default function RolesRedirectPage() {
  redirect('/admin/permissions')
}
