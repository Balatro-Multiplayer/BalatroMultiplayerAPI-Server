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
