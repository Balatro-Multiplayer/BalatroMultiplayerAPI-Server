'use client'

import Link from 'next/link'
import { nameOf } from '../../lib/format'
import type { StaffReportEvidence as Evidence } from '../../lib/types'
import { Section } from './shared'

// A moderator's note to admins about a match. The match page has the rest.
export function StaffReportEvidence({
  evidence,
  names,
}: {
  evidence: Evidence
  names: Map<string, string>
}) {
  return (
    <Section title='Staff report'>
      <p className='text-sm'>
        <Link
          className='text-bal-blue hover:underline'
          href={`/admin/players/${evidence.reporterId}`}
        >
          {nameOf(names, evidence.reporterId)}
        </Link>{' '}
        asks admins to look at this match.
      </p>
      <p className='whitespace-pre-wrap text-sm'>{evidence.note}</p>
      <Link
        className='text-bal-blue text-sm hover:underline'
        href={`/matches/${evidence.runId}`}
      >
        Open the match
      </Link>
    </Section>
  )
}
