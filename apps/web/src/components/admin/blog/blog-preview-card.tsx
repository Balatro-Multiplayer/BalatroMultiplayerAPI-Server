'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { foldMessage, linesOverFold } from '@/app/(home)/admin/blog/lib/posts'

// Pixel-approximate preview of how a post's bodyHtml renders inside the
// launcher's own #IntroCardBody card. The launcher renders sanitized
// bodyHtml straight from this API's allowlist (the same source this preview
// consumes), so dangerouslySetInnerHTML is a deliberate, scoped exception
// here -- not a pattern to copy elsewhere in this app.
//
// The 460px width / 398px fold height and 13px font size are the launcher's
// own QSS card sizing at its default window size (from the separate
// new-launcher repo, not this repo's job to change).
const CARD_WIDTH = 460
const FOLD_HEIGHT = 398
const CARD_PADDING = 16
const LINE_HEIGHT = 18

const BODY_STYLE =
	'[&_h3]:mb-1 [&_h3]:text-[#f5c04a] [&_h3]:text-base [&_p]:mb-2 [&_ul]:mb-2 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-none [&_ul>li]:before:content-["-_"] [&_a]:text-[#4aa8ff] [&_a]:underline'

export function BlogPreviewCard({ bodyHtml }: { bodyHtml: string }) {
	const isEmpty = !bodyHtml || bodyHtml === '<p></p>'
	const bodyRef = useRef<HTMLDivElement>(null)
	const [linesOver, setLinesOver] = useState(0)

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the html changes
	useLayoutEffect(() => {
		const height = bodyRef.current?.offsetHeight ?? 0
		setLinesOver(
			isEmpty
				? 0
				: linesOverFold(height + CARD_PADDING * 2, FOLD_HEIGHT, LINE_HEIGHT),
		)
	}, [bodyHtml, isEmpty])

	return (
		<section className="rounded-xl border border-border bg-card p-4">
			<div className="mb-3 flex items-baseline justify-between gap-2">
				<h2 className="font-pixel text-lg text-muted-foreground uppercase">
					Launcher preview
				</h2>
				<span className="text-muted-foreground text-xs">
					Default window, {CARD_WIDTH} px
				</span>
			</div>
			<div className="overflow-x-auto">
				<div
					className="overflow-hidden rounded-md border border-border bg-[#1a1a2e] text-white"
					style={{
						width: CARD_WIDTH,
						height: FOLD_HEIGHT,
						fontFamily: 'var(--font-m6x11)',
						fontSize: 13,
						lineHeight: `${LINE_HEIGHT}px`,
						padding: CARD_PADDING,
					}}
				>
					{isEmpty ? (
						<p className="text-white/40">Nothing to preview yet.</p>
					) : (
						<div
							ref={bodyRef}
							className={BODY_STYLE}
							// biome-ignore lint/security/noDangerouslySetInnerHtml: server-sanitized launcher HTML, see file header
							dangerouslySetInnerHTML={{ __html: bodyHtml }}
						/>
					)}
				</div>
				<div
					className="mt-1 border-amber-500 border-t-2 border-dashed pt-2"
					style={{ width: CARD_WIDTH }}
				>
					<p className="text-amber-500 text-xs">{foldMessage(linesOver)}</p>
				</div>
			</div>
		</section>
	)
}
