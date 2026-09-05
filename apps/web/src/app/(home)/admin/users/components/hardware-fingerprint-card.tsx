import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useState } from 'react'

export interface HardwareFingerprint {
	componentName: string
	componentHash: string
	platform: string
	firstSeenAt: string
	lastSeenAt: string
}

// Collapsed by default - these are 64-char hashes, not something to dump
// on screen the instant a player is selected. Raw hash values, not just
// component names - deliberate, see launcher-integrity.gateway.ts's own
// comment on why this is safe to show admin/moderator staff (a one-way
// HMAC-SHA256 output, not a raw hardware identifier).
export function HardwareFingerprintCard({
	fingerprints,
}: {
	fingerprints: HardwareFingerprint[]
}) {
	const [expanded, setExpanded] = useState(false)

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between space-y-0">
				<CardTitle className="text-base">
					Hardware Fingerprint
					<span className="ml-2 font-normal text-muted-foreground text-xs">
						({fingerprints.length} ID{fingerprints.length === 1 ? '' : 's'}{' '}
						captured)
					</span>
				</CardTitle>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={fingerprints.length === 0}
					onClick={() => setExpanded((v) => !v)}
				>
					{expanded ? 'Collapse' : 'Expand'}
				</Button>
			</CardHeader>
			{expanded && (
				<CardContent>
					{fingerprints.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							No hardware/device IDs captured for this player.
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Component</TableHead>
									<TableHead>Hashed value</TableHead>
									<TableHead>Platform</TableHead>
									<TableHead>First seen</TableHead>
									<TableHead>Last seen</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{fingerprints.map((f) => (
									<TableRow key={f.componentName}>
										<TableCell>
											<Badge
												variant="outline"
												className="font-mono text-[10px]"
											>
												{f.componentName}
											</Badge>
										</TableCell>
										<TableCell className="max-w-[280px] break-all font-mono text-[10px] text-muted-foreground">
											{f.componentHash}
										</TableCell>
										<TableCell className="text-xs capitalize">
											{f.platform}
										</TableCell>
										<TableCell className="text-xs">
											{new Date(f.firstSeenAt).toLocaleDateString()}
										</TableCell>
										<TableCell className="text-xs">
											{new Date(f.lastSeenAt).toLocaleDateString()}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			)}
		</Card>
	)
}
