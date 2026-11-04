// One-time job: closes every open automatic item (anti-cheat flags and
// integrity items) that the current rules would not make, as dismissed by the
// system with a note that names the rule, and writes a staff log entry for
// each. It prints how many it closed. It is safe to run again: a closed item
// is never listed, so a second run closes only what the first left.
// Run: `node dist/scripts/close-automatic-items.js`.
import { closeObsoleteItems } from '../features/service-queue/automatic-rules.js'
import { closeItemAsSystem, listOpenAutomaticCandidates } from '../infrastructure/gateways/automatic-items.gateway.js'

async function main() {
	const result = await closeObsoleteItems({ listOpen: listOpenAutomaticCandidates, close: closeItemAsSystem })
	console.log(`[automatic-items] Closed ${result.closed}, kept ${result.kept}, already closed ${result.skipped}`)
	for (const [rule, n] of Object.entries(result.byRule)) console.log(`[automatic-items]   ${rule}: ${n}`)
	process.exit(0)
}

main().catch((err) => {
	console.error('[automatic-items] Failed:', err)
	process.exit(1)
})
