'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect } from 'react'

// The editor lives on the blog page now.
export default function NewBlogPostPage() {
	return (
		<Suspense fallback={null}>
			<Redirect />
		</Suspense>
	)
}

function Redirect() {
	const router = useRouter()
	const kind = useSearchParams().get('kind')
	useEffect(() => {
		router.replace(
			`/admin/blog?new=${kind === 'patch_notes' ? 'patch_notes' : 'news'}`,
		)
	}, [router, kind])
	return null
}
