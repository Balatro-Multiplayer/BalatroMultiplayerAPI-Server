'use client'

import Image from 'next/image'
import type { ElementType } from 'react'
import slugify from 'slugify'

type JokerCardProps = {
  name: string
  img: string
  h?: number
}

export function JokerCard({ name, img, h = 3 }: JokerCardProps) {
  const Heading = `h${h}` as ElementType
  return (
    <div
      className={'flex scroll-mt-36 flex-col items-center gap-2'}
      id={`${slugify(name, { lower: true, strict: true })}-toc`}
    >
      <Image
        src={img}
        height={190}
        width={142}
        alt={name}
        className={'!m-0 max-w-24 rounded-md'}
      />
      <div className={'flex flex-col gap-1'}>
        <Heading className={'!m-0 text-nowrap font-medium text-sm'}>
          {name}
        </Heading>
      </div>
    </div>
  )
}
