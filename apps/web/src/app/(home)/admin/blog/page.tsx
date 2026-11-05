'use client'

import { useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { BlogPostEditor } from '@/components/admin/blog/blog-post-editor'
import { BlogPostsList } from '@/components/admin/blog/blog-posts-list'
import type { BlogPost, BlogPostKind } from '@/components/admin/blog/blog-types'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { type PostFilter, sortByUpdated } from './lib/posts'

interface PostsResponse {
	posts: BlogPost[]
}

type Selection =
	| { type: 'post'; id: number }
	| { type: 'new'; kind: BlogPostKind }
	| null

export default function AdminBlogPage() {
	return (
		<Suspense
			fallback={
				<div className="container py-8 text-muted-foreground">Loading…</div>
			}
		>
			<AdminBlogContent />
		</Suspense>
	)
}

// Admin surface for the launcher's blog/news feed -- see this server's
// features/webadmin/blog.route.ts for the API this consumes. Drafts are only
// ever visible here; the launcher itself only ever sees published posts.
// Three columns: the post list, the editor, the launcher preview. The old
// /admin/blog/new and /admin/blog/[id] URLs redirect here.
function AdminBlogContent() {
	const { isAdmin, isModerator, pending } = useAuth()
	const router = useRouter()
	const params = useSearchParams()
	const canAccess = isAdmin || isModerator

	const postParam = Number(params.get('post'))
	const newParam = params.get('new')
	const [selection, setSelection] = useState<Selection>(() =>
		Number.isInteger(postParam) && postParam > 0
			? { type: 'post', id: postParam }
			: newParam === 'news' || newParam === 'patch_notes'
				? { type: 'new', kind: newParam }
				: null,
	)
	const [filter, setFilter] = useState<PostFilter>('all')
	const dirtyRef = useRef(false)

	useEffect(() => {
		if (!pending && !canAccess) router.replace('/')
	}, [pending, canAccess, router])

	const postsQ = useQuery<PostsResponse>({
		queryKey: ['admin-blog-posts'],
		queryFn: () => apiFetch('/webadmin/blog/posts'),
		enabled: canAccess,
	})
	const posts = sortByUpdated(postsQ.data?.posts ?? [])

	const selectedPost =
		selection?.type === 'post'
			? posts.find((p) => p.id === selection.id)
			: selection === null
				? posts[0]
				: undefined

	const onDirtyChange = useCallback((d: boolean) => {
		dirtyRef.current = d
	}, [])

	// Leaving an editor with unsaved text asks first.
	const move = (next: Selection) => {
		if (dirtyRef.current && !window.confirm('Drop your unsaved changes?'))
			return
		dirtyRef.current = false
		setSelection(next)
	}

	if (pending) {
		return <div className="container py-8 text-muted-foreground">Loading…</div>
	}
	if (!canAccess) return null

	const editing = selection?.type === 'new' ? null : selectedPost
	const editorKey =
		selection?.type === 'new' ? `new-${selection.kind}` : `post-${editing?.id}`

	return (
		<div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-8">
			<div className="text-muted-foreground text-sm">
				Staff / Ops / <span className="text-primary">Blog</span>
			</div>
			<div className="flex flex-wrap items-baseline gap-x-4">
				<h1 className="font-pixel text-4xl">Blog</h1>
				<p className="text-muted-foreground text-sm">
					News and patch notes shown in the BET Launcher. Drafts are seen only
					here.
				</p>
			</div>

			<div className="grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)_minmax(0,32rem)]">
				<BlogPostsList
					posts={posts}
					isLoading={postsQ.isLoading}
					filter={filter}
					onFilter={setFilter}
					selectedId={editing?.id ?? null}
					onSelect={(p) => move({ type: 'post', id: p.id })}
					onNew={(kind) => move({ type: 'new', kind })}
				/>
				{selection?.type === 'new' || editing ? (
					<BlogPostEditor
						key={editorKey}
						post={editing ?? undefined}
						initialKind={selection?.type === 'new' ? selection.kind : 'news'}
						onCreated={(p) => {
							dirtyRef.current = false
							setSelection({ type: 'post', id: p.id })
						}}
						onDeleted={() => {
							dirtyRef.current = false
							setSelection(null)
						}}
						onDirtyChange={onDirtyChange}
					/>
				) : (
					<p className="rounded-xl border border-border bg-card p-6 text-muted-foreground text-sm lg:col-span-1 xl:col-span-2">
						{postsQ.isLoading
							? 'Loading…'
							: 'No post open. Pick one from the list or start a new one.'}
					</p>
				)}
			</div>
		</div>
	)
}
