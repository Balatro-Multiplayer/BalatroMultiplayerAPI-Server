import { redirect } from 'next/navigation'
import { ProfileSettingsPageClient } from '@/app/(home)/profile/settings/page-client'
import { auth } from '@/server/auth'
import { api, HydrateClient } from '@/trpc/server'
import { createMetadata } from '../../../../../lib/metadata'

export const metadata = createMetadata({
  title: 'Profile Settings',
  description:
    'Manage your Balatro Multiplayer profile links and account settings.',
  path: '/profile/settings',
  noIndex: true,
})

export default async function ProfileSettingsPage() {
  const session = await auth()
  if (!session) {
    redirect('/')
  }
  await Promise.all([api.profile.getSocialLinks.prefetch()])
  return (
    <HydrateClient>
      <ProfileSettingsPageClient userId={session.user.discord_id} />
    </HydrateClient>
  )
}
