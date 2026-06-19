import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { hasPermission } from '@/lib/permissions'
import { auth } from '@/server/auth'
import { createMetadata } from '../../../../../lib/metadata'

import { AdminBlogClient } from './blog-client'

export const metadata = createMetadata({
  title: 'Manage Blog Posts',
  description: 'Create, edit, and publish blog posts.',
  path: '/admin/blog',
  noIndex: true,
})

export default async function AdminBlogPage() {
  const session = await auth()

  if (!hasPermission(session?.user, 'blog.manage')) {
    redirect('/')
  }

  return (
    <div className='mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-col gap-4 py-8'>
      <div className='flex items-center justify-between'>
        <h1 className='font-bold text-4xl'>Manage Blog Posts</h1>
        <Button asChild>
          <Link href='/admin/blog/new'>Create New Post</Link>
        </Button>
      </div>

      <AdminBlogClient />
    </div>
  )
}
