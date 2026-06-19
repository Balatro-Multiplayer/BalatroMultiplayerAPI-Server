import type { Metadata } from 'next'
import { source } from './source'

type DocPage = NonNullable<ReturnType<typeof source.getPage>>
const ROOT_DOCS_OG_SLUG = '_index'

export const siteConfig = {
  description: 'The official Balatro Multiplayer mod website.',
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
  type?: 'article' | 'website'
}

export function withSiteTitle(title: string) {
  return title.endsWith(`| ${siteConfig.name}`)
    ? title
    : `${title} | ${siteConfig.name}`
}

function normalizePath(path = '/') {
  if (path === '/') {
    return path
  }

  return path.startsWith('/') ? path : `/${path}`
}

function normalizeImages(images?: string | string[]) {
  if (!images) {
    return [siteConfig.ogImage]
  }

  return Array.isArray(images) ? images : [images]
}

export function createMetadata({
  description = siteConfig.description,
  images,
  noIndex = false,
  path = '/',
  title,
  type = 'website',
}: CreateMetadataInput = {}): Metadata {
  const normalizedPath = normalizePath(path)
  const normalizedImages = normalizeImages(images)
  const resolvedTitle = title ?? siteConfig.name

  return {
    ...(title
      ? {
          title: {
            absolute: withSiteTitle(title),
          },
        }
      : {}),
    description,
    alternates: {
      canonical: normalizedPath,
    },
    openGraph: {
      title: resolvedTitle,
      description,
      url: normalizedPath,
      siteName: siteConfig.name,
      locale: 'en_US',
      type,
      images: normalizedImages,
    },
    twitter: {
      card: 'summary_large_image',
      title: resolvedTitle,
      description,
      images: normalizedImages,
    },
    ...(noIndex
      ? {
          robots: {
            index: false,
            follow: false,
          },
        }
      : {}),
  }
}

function getImagePath(slugs?: string[]) {
  const routeSlugs = slugs && slugs.length > 0 ? slugs : [ROOT_DOCS_OG_SLUG]
  const path = routeSlugs.join('/')
  return `/docs-og/${path}`
}

export const metadataImage = {
  createAPI(render: (page: DocPage) => Response | Promise<Response>) {
    return async (
      _request: Request,
      context: { params: Promise<{ slug?: string[] }> }
    ) => {
      const { slug } = await context.params
      const normalizedSlug =
        slug?.length === 1 && slug[0] === ROOT_DOCS_OG_SLUG ? [] : slug
      const page = source.getPage(normalizedSlug)

      if (!page) {
        return new Response('Not found', { status: 404 })
      }

      return render(page as DocPage)
    }
  },
  generateParams() {
    return source.generateParams().map((params) => ({
      ...params,
      slug:
        params.slug && params.slug.length > 0
          ? params.slug
          : [ROOT_DOCS_OG_SLUG],
    }))
  },
  withImage(
    slugs: string[] | undefined,
    metadata: Pick<Metadata, 'title' | 'description'>
  ): Metadata {
    const image = getImagePath(slugs)
    const path =
      slugs && slugs.length > 0 ? `/docs/${slugs.join('/')}` : '/docs'

    return createMetadata({
      title:
        typeof metadata.title === 'string' ? metadata.title : siteConfig.name,
      description: metadata.description ?? siteConfig.description,
      path,
      images: image,
      type: 'article',
    })
  },
}
