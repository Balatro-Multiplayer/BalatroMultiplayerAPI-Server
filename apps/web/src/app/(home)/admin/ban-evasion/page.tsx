'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

interface MatchedComponent {
	componentName: string
	componentHash: string
}

interface BanEvasionMatch {
	bannedPlayerId: string
	bannedPlayerName: string
	matchedPlayerId: string
	matchedPlayerName: string
	matchedPlayerHasActiveBan: boolean
	matchedComponents: MatchedComponent[]
}

interface BanEvasionResponse {
	matches: BanEvasionMatch[]
}

interface PlatformStats {
	platform: string
	rowCount: number
	playerCount: number
	components: string[]
}

interface HardwareFingerprintStatsResponse {
	totalRows: number
	byPlatform: PlatformStats[]
}

// Component reliability legend, kept next to the table rather than only in
// engineering docs - see hardwarefingerprint.cpp for the actual collectors.
// Every match below is weighted equally today (a plain shared-component
// count) regardless of this table, since there isn't yet enough real match
// data to justify specific weights - this is context for *reading* a match,
// not something the current sort/count uses.
const COMPONENT_RELIABILITY: { label: string; components: string[] }[] = [
	{
		label: 'Hard to fake on real hardware',
		components: ['hardware_serial', 'platform_uuid', 'tpm_ek_hash'],
	},
	{
		label: 'Needs 3rd-party tooling to fake',
		components: ['disk_serial', 'board_serial', 'system_uuid', 'gpu_id'],
	},
	{
		label: 'Trivial to fake (a registry edit or one command)',
		components: ['machine_guid', 'machine_id', 'mac_address', 'volume_serial'],
	},
	{
		label:
			'Not spoofable, but also not distinguishing (common CPU model) or not a hardware signal at all (a new account, by definition)',
		components: ['cpu_id', 'steam_id'],
	},
]

export default function BanEvasionPage() {
	const { isAdmin, isModerator, pending } = useAuth()
	const router = useRouter()
	const canAccess = isAdmin || isModerator

	useEffect(() => {
		if (!pending && !canAccess) router.replace('/')
	}, [pending, canAccess, router])

	const { data, isLoading } = useQuery<BanEvasionResponse>({
		queryKey: ['admin-ban-evasion'],
		queryFn: () => apiFetch('/webadmin/ban-evasion'),
		enabled: canAccess,
	})

	// Separate call from the matches above - this is a different question
	// (what's actually being collected, in aggregate, right now) than
	// specific suspected-alt pairs, and only needs to load once per visit,
	// not whenever the match list itself would refresh.
	const { data: stats, isLoading: statsLoading } =
		useQuery<HardwareFingerprintStatsResponse>({
			queryKey: ['admin-hardware-fingerprint-stats'],
			queryFn: () => apiFetch('/webadmin/hardware-fingerprint-stats'),
			enabled: canAccess,
		})

	if (pending) {
		return <div className="container py-8 text-muted-foreground">Loading…</div>
	}
	if (!canAccess) return null

	const matches = data?.matches ?? []

	return (
		<div className="container py-8 space-y-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Ban Evasion</h1>
				<p className="text-sm text-muted-foreground">
					Currently-banned players who share a hardware/device identifier with
					another account. A shared component is a hint, not proof - see the
					reliability notes below before acting on a match.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="text-base">Total IDs Captured</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3 text-sm">
					{statsLoading ? (
						<p className="text-muted-foreground">Loading…</p>
					) : (
						<>
							<p>
								<span className="font-bold text-lg">
									{stats?.totalRows ?? 0}
								</span>{' '}
								<span className="text-muted-foreground">
									hardware/device IDs captured across every player, all
									platforms.
								</span>
							</p>
							{(stats?.byPlatform ?? []).length === 0 ? (
								<p className="text-muted-foreground">Nothing captured yet.</p>
							) : (
								<div className="space-y-2">
									{stats?.byPlatform.map((p) => (
										<div
											key={p.platform}
											className="rounded-md border border-border p-3"
										>
											<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
												<span className="font-semibold capitalize">
													{p.platform}
												</span>
												<span className="text-muted-foreground text-xs">
													{p.rowCount} ID{p.rowCount === 1 ? '' : 's'} across{' '}
													{p.playerCount} player{p.playerCount === 1 ? '' : 's'}
												</span>
											</div>
											<div className="mt-1.5 flex flex-wrap gap-1">
												{p.components.map((c) => (
													<Badge
														key={c}
														variant="outline"
														className="font-mono text-[10px]"
													>
														{c}
													</Badge>
												))}
											</div>
										</div>
									))}
								</div>
							)}
						</>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="text-base">Component reliability</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2 text-sm">
					{COMPONENT_RELIABILITY.map((tier) => (
						<div key={tier.label} className="flex flex-wrap items-center gap-2">
							<span className="text-muted-foreground">{tier.label}:</span>
							{tier.components.map((c) => (
								<Badge
									key={c}
									variant="outline"
									className="font-mono text-[10px]"
								>
									{c}
								</Badge>
							))}
						</div>
					))}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="text-base">Matches</CardTitle>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<p className="text-sm text-muted-foreground">Loading…</p>
					) : matches.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No currently-banned player shares a hardware/device identifier
							with another account.
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Banned player</TableHead>
									<TableHead>Matched account</TableHead>
									<TableHead>Shared components (hashed value)</TableHead>
									<TableHead>Count</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{matches.map((m) => (
									<TableRow key={`${m.bannedPlayerId}:${m.matchedPlayerId}`}>
										<TableCell>
											<Link
												href={`/admin/users?playerId=${m.bannedPlayerId}`}
												className="text-blue-400 hover:text-blue-300"
											>
												{m.bannedPlayerName}
											</Link>
										</TableCell>
										<TableCell>
											<Link
												href={`/admin/users?playerId=${m.matchedPlayerId}`}
												className="text-blue-400 hover:text-blue-300"
											>
												{m.matchedPlayerName}
											</Link>
											{m.matchedPlayerHasActiveBan && (
												<Badge
													variant="destructive"
													className="ml-2 text-[10px]"
												>
													also banned
												</Badge>
											)}
										</TableCell>
										<TableCell>
											<div className="space-y-1">
												{m.matchedComponents.map((c) => (
													<div
														key={c.componentName}
														className="flex flex-wrap items-baseline gap-1.5"
													>
														<Badge
															variant="outline"
															className="font-mono text-[10px]"
														>
															{c.componentName}
														</Badge>
														<span className="break-all font-mono text-[10px] text-muted-foreground">
															{c.componentHash}
														</span>
													</div>
												))}
											</div>
										</TableCell>
										<TableCell>{m.matchedComponents.length}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
