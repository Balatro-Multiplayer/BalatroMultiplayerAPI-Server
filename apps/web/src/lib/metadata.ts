import type { Metadata } from 'next'

export const siteConfig = {
  description: 'The unofficial multiplayer mod for Balatro.',
  name: 'Balatro Multiplayer',
  ogImage: '/multiplayer-screenshot.jpeg',
  url: 'https://balatromp.com',
} as const

type CreateMetadataInput = {
  description?: string
  images?: string | string[]
  noIndex?: boolean
  path?: string
  title?: string
}

export function createMetadata({
  description = siteConfig.description,
  images,
  noIndex = false,
  path = '/',
  title,
}: CreateMetadataInput = {}): Metadata {
  const normalizedImages = images
    ? Array.isArray(images)
      ? images
      : [images]
    : [siteConfig.ogImage]
  const resolvedTitle = title ?? siteConfig.name

  return {
    ...(title ? { title: { absolute: `${title} | ${siteConfig.name}` } } : {}),
    description,
    alternates: { canonical: path },
    openGraph: {
      title: resolvedTitle,
      description,
      url: path,
      siteName: siteConfig.name,
      locale: 'en_US',
      type: 'website',
      images: normalizedImages,
    },
    twitter: {
      card: 'summary_large_image',
      title: resolvedTitle,
      description,
      images: normalizedImages,
    },
    ...(noIndex ? { robots: { index: false, follow: false } } : {}),
  }
}

export const metadataImage = {
  withImage(
    slugs: string[] | undefined,
    meta: Pick<import('next').Metadata, 'title' | 'description'>,
  ): import('next').Metadata {
    const path = slugs && slugs.length > 0 ? `/docs/${slugs.join('/')}` : '/docs'
    return createMetadata({
      title: typeof meta.title === 'string' ? meta.title : siteConfig.name,
      description: typeof meta.description === 'string' ? meta.description : siteConfig.description,
      path,
    })
  },
}
