export type BlogPostKind = 'patch_notes' | 'news'
export type BlogPostStatus = 'draft' | 'published'

export interface BlogPost {
  id: number
  kind: BlogPostKind
  title: string
  bodyHtml: string
  status: BlogPostStatus
  publishedAt: string | null
  authorPlayerId: string
  createdAt: string
  updatedAt: string
}

// Controlled-object shape for the create/edit editor -- kind is only used on
// create (POST accepts it; PATCH doesn't, and there's no way to change an
// existing post's kind via the API).
export interface BlogPostForm {
  kind: BlogPostKind
  title: string
  bodyHtml: string
}

export const BLOG_POST_KIND_LABELS: Record<BlogPostKind, string> = {
  patch_notes: 'Patch Notes',
  news: 'News',
}
