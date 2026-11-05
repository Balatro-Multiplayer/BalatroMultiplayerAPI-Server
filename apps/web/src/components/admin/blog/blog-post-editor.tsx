'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { canPublish } from '@/app/(home)/admin/blog/lib/posts'
import { ConfirmCard } from '@/components/admin/confirm-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError, apiFetchWithReason } from '@/lib/api'
import { BlogPreviewCard } from './blog-preview-card'
import { BlogTiptapEditor } from './blog-tiptap-editor'
import {
	BLOG_POST_KIND_LABELS,
	type BlogPost,
	type BlogPostForm,
	type BlogPostKind,
} from './blog-types'

function onErr(e: unknown) {
	toast.error(
		e instanceof ApiError
			? e.message
			: e instanceof Error
				? e.message
				: 'Request failed',
	)
}

// The editor column and the launcher preview column of the blog page. They
// are two siblings so the page grid places them. A new post (post ===
// undefined) has its kind picked up-front; an existing post's kind is fixed.
export function BlogPostEditor({
	post,
	initialKind = 'news',
	onCreated,
	onDeleted,
	onDirtyChange,
}: {
	post?: BlogPost
	initialKind?: BlogPostKind
	onCreated: (post: BlogPost) => void
	onDeleted: () => void
	onDirtyChange: (dirty: boolean) => void
}) {
	const qc = useQueryClient()
	const isEdit = post !== undefined

	const [form, setForm] = useState<BlogPostForm>(() => ({
		kind: post?.kind ?? initialKind,
		title: post?.title ?? '',
		bodyHtml: post?.bodyHtml ?? '',
	}))
	const [note, setNote] = useState('')
	const [confirmingDelete, setConfirmingDelete] = useState(false)

	const dirty = isEdit
		? form.title !== post.title || form.bodyHtml !== post.bodyHtml
		: form.title.trim() !== '' || form.bodyHtml.replace('<p></p>', '') !== ''
	useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

	const invalidate = () => {
		qc.invalidateQueries({ queryKey: ['admin-blog-posts'] })
		if (post)
			qc.invalidateQueries({ queryKey: ['admin-blog-post', String(post.id)] })
	}

	const saveMutation = useMutation({
		mutationFn: () =>
			isEdit
				? apiFetchWithReason<{ post: BlogPost }>(
						`/webadmin/blog/posts/${post.id}`,
						{
							method: 'PATCH',
							body: JSON.stringify({
								title: form.title,
								bodyHtml: form.bodyHtml,
							}),
						},
						note,
					)
				: apiFetchWithReason<{ post: BlogPost }>(
						'/webadmin/blog/posts',
						{ method: 'POST', body: JSON.stringify(form) },
						note,
					),
		onSuccess: (data) => {
			toast.success(isEdit ? 'Post saved' : 'Draft created')
			setNote('')
			invalidate()
			if (!isEdit) onCreated(data.post)
		},
		onError: onErr,
	})

	const toggleMutation = useMutation({
		mutationFn: (action: 'publish' | 'unpublish') =>
			apiFetchWithReason<{ post: BlogPost }>(
				`/webadmin/blog/posts/${post?.id}/${action}`,
				{ method: 'POST' },
				note,
			),
		onSuccess: (_d, action) => {
			toast.success(
				action === 'publish' ? 'Post published' : 'Post unpublished',
			)
			setNote('')
			invalidate()
		},
		onError: onErr,
	})

	const deleteMutation = useMutation({
		mutationFn: (deleteNote: string) =>
			apiFetchWithReason(
				`/webadmin/blog/posts/${post?.id}`,
				{ method: 'DELETE' },
				deleteNote,
			),
		onSuccess: () => {
			toast.success('Post deleted')
			setConfirmingDelete(false)
			invalidate()
			onDeleted()
		},
		onError: onErr,
	})

	const busy =
		saveMutation.isPending ||
		toggleMutation.isPending ||
		deleteMutation.isPending
	const noteReady = note.trim().length > 0
	const published = post?.status === 'published'

	return (
		<>
			<section className="space-y-4 rounded-xl border border-border bg-card p-4">
				<div className="flex flex-wrap items-center gap-2 text-sm">
					{isEdit && (
						<Badge variant={published ? 'default' : 'secondary'}>
							{published ? 'Published' : 'Draft'}
						</Badge>
					)}
					<Badge variant="outline">{BLOG_POST_KIND_LABELS[form.kind]}</Badge>
					<span className="text-muted-foreground text-xs">
						{isEdit
							? 'Kind cannot change after creation.'
							: 'A new post starts as a draft.'}
					</span>
					{isEdit && (
						<span className="ml-auto text-muted-foreground text-xs">
							By{' '}
							<Link
								href={`/admin/players/${post.authorPlayerId}`}
								className="font-mono hover:text-primary hover:underline"
							>
								{post.authorPlayerId}
							</Link>
							, updated{' '}
							<span className="font-mono">
								{new Date(post.updatedAt).toLocaleString()}
							</span>
						</span>
					)}
				</div>

				<div className="space-y-2">
					<Label htmlFor="post-title">Title</Label>
					<Input
						id="post-title"
						value={form.title}
						onChange={(e) => setForm({ ...form, title: e.target.value })}
						required
					/>
				</div>

				<div className="space-y-2">
					<Label>Body</Label>
					<BlogTiptapEditor
						value={form.bodyHtml}
						onChange={(bodyHtml) => setForm({ ...form, bodyHtml })}
					/>
				</div>

				<div className="space-y-2 border-border border-t pt-4">
					<Label htmlFor="blog-note">Note for the staff log (needed)</Label>
					<Input
						id="blog-note"
						value={note}
						onChange={(e) => setNote(e.target.value)}
						placeholder="Why this change?"
						disabled={busy}
					/>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							onClick={() => saveMutation.mutate()}
							disabled={busy || !noteReady || !form.title.trim()}
						>
							{saveMutation.isPending
								? 'Saving…'
								: isEdit
									? 'Save changes'
									: 'Create draft'}
						</Button>
						{isEdit && (
							<Button
								type="button"
								variant="secondary"
								onClick={() =>
									toggleMutation.mutate(published ? 'unpublish' : 'publish')
								}
								disabled={!canPublish(dirty, note, busy)}
								title={dirty ? 'Save your changes first' : undefined}
							>
								{toggleMutation.isPending
									? 'Sending…'
									: published
										? 'Unpublish'
										: 'Publish'}
							</Button>
						)}
						{isEdit && (
							<Button
								type="button"
								variant="outline"
								className="ml-auto border-destructive/60 text-destructive hover:text-destructive"
								disabled={busy}
								onClick={() => setConfirmingDelete(true)}
							>
								Delete post…
							</Button>
						)}
					</div>
					{isEdit && dirty && (
						<p className="text-muted-foreground text-xs">
							Save your changes before you publish or unpublish.
						</p>
					)}
				</div>

				{isEdit && confirmingDelete && (
					<ConfirmCard
						title={`Delete "${post.title || 'Untitled'}"?`}
						rows={[
							{
								label: 'Post',
								value: (
									<>
										<s className="text-muted-foreground">
											{BLOG_POST_KIND_LABELS[post.kind]},{' '}
											{published ? 'published' : 'draft'}
										</s>{' '}
										to deleted
									</>
								),
							},
							{
								label: 'Players',
								value: published
									? 'The post leaves the launcher at once'
									: 'No player sees this draft today',
							},
							{ label: 'Undo', value: 'None. A deleted post cannot come back' },
						]}
						presets={['Posted by mistake', 'Out of date']}
						placeholder="Why delete this post?"
						confirmLabel="Delete post"
						pending={deleteMutation.isPending}
						onCancel={() => setConfirmingDelete(false)}
						onConfirm={(n) => deleteMutation.mutate(n)}
					/>
				)}
			</section>

			<BlogPreviewCard bodyHtml={form.bodyHtml} />
		</>
	)
}
