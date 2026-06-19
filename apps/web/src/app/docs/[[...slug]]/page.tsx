import type { TOCItemType } from 'fumadocs-core/toc'
import { ImageZoom } from 'fumadocs-ui/components/image-zoom'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/page'
import { notFound } from 'next/navigation'
import type { ComponentProps, ComponentType } from 'react'
import { Chance } from '@/app/_components/chance'
import { Chips } from '@/app/_components/chips'
import { Hands } from '@/app/_components/hands'
import { JokerCard } from '@/app/_components/joker-card'
import { Money } from '@/app/_components/money'
import { Mult } from '@/app/_components/mult'
import { Nemesis } from '@/app/_components/nemesis'
import { Spectral } from '@/app/_components/spectral'
import { Xmult } from '@/app/_components/xmult'
import { Button } from '@/components/ui/button'
import { env } from '@/env'
import { CDN_URL } from '@/shared/constants'
import { metadataImage } from '../../../../lib/metadata'
import { source } from '../../../../lib/source'

type ImageZoomProps = ComponentProps<typeof ImageZoom>
type ButtonProps = ComponentProps<typeof Button>
type JokerCardProps = ComponentProps<typeof JokerCard>
type ChipsProps = ComponentProps<typeof Chips>
type HandsProps = ComponentProps<typeof Hands>
type ChanceProps = ComponentProps<typeof Chance>
type MoneyProps = ComponentProps<typeof Money>
type XmultProps = ComponentProps<typeof Xmult>
type SpectralProps = ComponentProps<typeof Spectral>
type MultProps = ComponentProps<typeof Mult>
type NemesisProps = ComponentProps<typeof Nemesis>
type DocsPageData = NonNullable<ReturnType<typeof source.getPage>> & {
  data: {
    body: ComponentType<{
      components?: Record<string, ComponentType<Record<string, unknown>>>
    }>
    description?: string
    full?: boolean
    title: string
    toc: TOCItemType[]
  }
}

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>
}) {
  const params = await props.params
  const page = source.getPage(params.slug) as DocsPageData | undefined
  if (!page) notFound()
  const isFullWidth = page.data.full ?? true

  const MDX = page.data.body

  return (
    <DocsPage
      toc={page.data.toc}
      tableOfContent={{
        enabled: page.data.toc.length > 0,
        style: 'clerk',
      }}
      full={isFullWidth}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX
          components={{
            ...defaultMdxComponents,
            img: (props) => {
              const isDev =
                env.NODE_ENV === 'development' || env.IS_PREVIEW === 'true'
              const imageProps = props as ImageZoomProps
              if (isDev) {
                return <ImageZoom {...imageProps} />
              }

              const src =
                typeof imageProps.src === 'string' ? imageProps.src : undefined
              return (
                <ImageZoom
                  {...imageProps}
                  src={
                    src?.startsWith('/') ? `${CDN_URL}${src}` : imageProps.src
                  }
                />
              )
            },
            Button: (props: ButtonProps) => <Button {...props} />,
            JokerCard: (props: JokerCardProps) => <JokerCard {...props} />,
            Chips: (props: ChipsProps) => <Chips {...props} />,
            Hands: (props: HandsProps) => <Hands {...props} />,
            Chance: (props: ChanceProps) => <Chance {...props} />,
            Money: (props: MoneyProps) => <Money {...props} />,
            Xmult: (props: XmultProps) => <Xmult {...props} />,
            Spectral: (props: SpectralProps) => <Spectral {...props} />,
            Mult: (props: MultProps) => <Mult {...props} />,
            Nemesis: (props: NemesisProps) => <Nemesis {...props} />,
          }}
        />
      </DocsBody>
    </DocsPage>
  )
}

export async function generateStaticParams() {
  return source.generateParams()
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>
}): Promise<import('next').Metadata> {
  const params = await props.params
  const page = source.getPage(params.slug) as DocsPageData | undefined
  if (!page) notFound()

  return metadataImage.withImage(page.slugs, {
    title: page.data.title,
    description: page.data.description,
  })
}
