'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { MarkdownEditor } from '@/components/markdown-editor'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/trpc/react'

export default function EditBlogPostPage() {
  const params = useParams<{
    id: string
  }>()
  const id = Number.parseInt(params.id, 10)
  const router = useRouter()

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [excerpt, setExcerpt] = useState('')
  const [published, setPublished] = useState(false)
  const [updateSlug, setUpdateSlug] = useState(false)
  const [authorId, setAuthorId] = useState<string | undefined>(undefined)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Fetch post data
  const { data: posts, isLoading: isFetching } = api.blog.getAll.useQuery()

  // Fetch all users for author selection
  const { data: users, isLoading: isLoadingUsers } =
    api.blog.getAllUsers.useQuery()

  useEffect(() => {
    if (posts) {
      const currentPost = posts.find((p) => p.id === id)
      if (currentPost) {
        setTitle(currentPost.title)
        setContent(currentPost.content)
        setExcerpt(currentPost.excerpt || '')
        setPublished(currentPost.published)
        setAuthorId(currentPost.authorId)
        setIsLoading(false)
      } else {
        toast.error('Blog post not found')
        router.push('/admin/blog')
      }
    }
  }, [posts, id, router])

  // Update post mutation
  const updatePost = api.blog.update.useMutation({
    onSuccess: () => {
      toast.success('Blog post updated successfully')
      router.push('/admin/blog')
      router.refresh()
    },
    onError: (error) => {
      toast.error(`Error updating blog post: ${error.message}`)
      setIsSubmitting(false)
    },
  })

  // Delete post mutation
  const deletePost = api.blog.delete.useMutation({
    onSuccess: () => {
      toast.success('Blog post deleted successfully')
      router.push('/admin/blog')
      router.refresh()
    },
    onError: (error) => {
      toast.error(`Error deleting blog post: ${error.message}`)
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!title.trim()) {
      toast.error('Title is required')
      return
    }

    if (!content.trim()) {
      toast.error('Content is required')
      return
    }

    setIsSubmitting(true)

    updatePost.mutate({
      id,
      title,
      content,
      excerpt: excerpt || undefined,
      published,
      updateSlug,
      authorId,
    })
  }

  const handleDelete = () => {
    deletePost.mutate({ id })
  }

  if (isLoading || isFetching) {
    return (
      <div className='mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-col gap-8 py-8'>
        <h1 className='font-bold text-4xl'>Edit Blog Post</h1>
        <div className='flex items-center justify-center p-8'>
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className='mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-col gap-8 py-8'>
      <div className='flex items-center justify-between'>
        <h1 className='font-bold text-4xl'>Edit Blog Post</h1>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant='destructive'>Delete Post</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete the
                blog post.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <form onSubmit={handleSubmit} className='space-y-8'>
        <div className='space-y-2'>
          <Label htmlFor='title'>Title</Label>
          <Input
            id='title'
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder='Enter post title'
            required
          />
        </div>

        <div className='space-y-2'>
          <Label htmlFor='excerpt'>Excerpt (optional)</Label>
          <Textarea
            id='excerpt'
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            placeholder='Brief summary of the post'
            className='h-24'
          />
        </div>

        <div className='space-y-2'>
          <Label htmlFor='author'>Author</Label>
          <Select value={authorId} onValueChange={setAuthorId}>
            <SelectTrigger id='author'>
              <SelectValue placeholder='Select an author' />
            </SelectTrigger>
            <SelectContent>
              {isLoadingUsers ? (
                <SelectItem value='loading' disabled>
                  Loading...
                </SelectItem>
              ) : (
                users?.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        <div className='space-y-2'>
          <Label htmlFor='content'>Content</Label>
          <MarkdownEditor
            value={content}
            onChange={setContent}
            placeholder='Write your blog post content here...'
            minHeight='500px'
          />
        </div>

        <div className='flex flex-col gap-4'>
          <div className='flex items-center space-x-2'>
            <Switch
              id='published'
              checked={published}
              onCheckedChange={setPublished}
            />
            <Label htmlFor='published'>Published</Label>
          </div>

          <div className='flex items-center space-x-2'>
            <Switch
              id='updateSlug'
              checked={updateSlug}
              onCheckedChange={setUpdateSlug}
            />
            <Label htmlFor='updateSlug'>Update URL slug from title</Label>
          </div>
        </div>

        <div className='flex gap-4'>
          <Button type='submit' disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </Button>
          <Button
            type='button'
            variant='outline'
            onClick={() => router.push('/admin/blog')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
