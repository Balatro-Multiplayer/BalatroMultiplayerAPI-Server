'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect } from 'react'

// The editor lives on the blog page now.
export default function EditBlogPostPage() {
	const router = useRouter()
	const id = useParams().id as string
	useEffect(() => {
		router.replace(`/admin/blog?post=${encodeURIComponent(id)}`)
	}, [router, id])
	return null
}
