import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { auth } from '@/server/auth'
import EditBlogPostClient from './edit-blog-post-client'

export default async function EditBlogPostPage() {
  const session = await auth()

  if (!hasPermission(session?.user, 'blog.manage')) {
    redirect('/')
  }

  return <EditBlogPostClient />
}
