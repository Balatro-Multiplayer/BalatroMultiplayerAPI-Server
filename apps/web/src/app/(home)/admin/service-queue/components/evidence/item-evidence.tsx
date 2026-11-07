'use client'

import type { ItemDetail, TypedEvidence } from '../../lib/types'
import { AppealEvidence } from './appeal-evidence'
import { ContestEvidence } from './contest-evidence'
import { AntiCheatEvidence } from './anti-cheat-evidence'
import { FlaggedChatEvidence } from './flagged-chat-evidence'
import { ForfeitEvidence } from './forfeit-evidence'
import { IntegrityEvidence } from './integrity-evidence'
import { MatchConflictEvidence } from './match-conflict-evidence'
import { ReportEvidence } from './report-evidence'
import { Empty } from './shared'

// The server picks the evidence's shape by the item's type.
const typed = (detail: ItemDetail) =>
  ({
    itemType: detail.item.itemType,
    evidence: detail.evidence,
  }) as TypedEvidence

export function ItemEvidence({
  detail,
  names,
}: {
  detail: ItemDetail
  names: Map<string, string>
}) {
  const t = typed(detail)
  if (!t.evidence)
    return <Empty>The item's source record is gone; no evidence to show.</Empty>
  switch (t.itemType) {
    case 'report':
      return <ReportEvidence evidence={t.evidence} names={names} />
    case 'flagged_chat':
      return <FlaggedChatEvidence evidence={t.evidence} />
    case 'match_conflict':
      return <MatchConflictEvidence evidence={t.evidence} names={names} />
    case 'contest':
      return <ContestEvidence evidence={t.evidence} names={names} />
    case 'forfeit_reconciliation':
      return <ForfeitEvidence evidence={t.evidence} names={names} />
    case 'anti_cheat':
      return <AntiCheatEvidence evidence={t.evidence} names={names} />
    case 'integrity':
      return <IntegrityEvidence evidence={t.evidence} />
    case 'appeal':
      return <AppealEvidence evidence={t.evidence} />
  }
}
