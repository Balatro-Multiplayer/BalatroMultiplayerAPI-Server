import type { BlogPost } from '@/components/admin/blog/blog-types'

export type PostFilter = 'all' | 'drafts' | 'published'

export function filterPosts(posts: BlogPost[], filter: PostFilter): BlogPost[] {
	if (filter === 'all') return posts
	const status = filter === 'drafts' ? 'draft' : 'published'
	return posts.filter((p) => p.status === status)
}

export function postCounts(posts: BlogPost[]): Record<PostFilter, number> {
	const drafts = posts.filter((p) => p.status === 'draft').length
	return { all: posts.length, drafts, published: posts.length - drafts }
}

// Newest edit first, so the post staff touched last is on top.
export function sortByUpdated(posts: BlogPost[]): BlogPost[] {
	return [...posts].sort(
		(a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
	)
}

// How many whole text lines of a body sit below the launcher card's fold.
export function linesOverFold(
	contentHeight: number,
	foldHeight: number,
	lineHeight: number,
): number {
	const over = contentHeight - foldHeight
	return over <= 0 ? 0 : Math.ceil(over / lineHeight)
}

export function foldMessage(lines: number): string {
	return lines === 0
		? 'Below this line does not fit in the launcher card. 0 lines over.'
		: `Below this line does not fit in the launcher card. ${lines} ${lines === 1 ? 'line' : 'lines'} over.`
}

// A draft can be published only when its saved text is what the editor shows.
export function canPublish(
	dirty: boolean,
	note: string,
	pending: boolean,
): boolean {
	return !dirty && !pending && note.trim().length > 0
}
