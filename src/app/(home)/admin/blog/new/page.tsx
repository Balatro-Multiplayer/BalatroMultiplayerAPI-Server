import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { auth } from '@/server/auth'
import NewBlogPostClient from './new-blog-post-client'

export default async function NewBlogPostPage() {
  const session = await auth()

  if (!hasPermission(session?.user, 'blog.manage')) {
    redirect('/')
  }

  return <NewBlogPostClient />
}
