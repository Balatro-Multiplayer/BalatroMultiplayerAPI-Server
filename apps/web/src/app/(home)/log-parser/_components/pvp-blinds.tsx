'use client'

import { TableShell } from '@/app/_components/table-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// Define the structure for hand scores within a PVP blind
export type HandScore = {
  timestamp: Date
  gainedScore: number
  totalScore: number
  handsLeft: number
  isLogOwner: boolean
}

// Define the structure for PVP blind data
export type PvpBlind = {
  blindNumber: number
  startTimestamp: Date
  endTimestamp?: Date
  logOwnerScore: number
  opponentScore: number
  handScores: HandScore[]
  winner: 'logOwner' | 'opponent' | null
}

// Only include the properties needed for this component
type Game = {
  pvpBlinds: PvpBlind[]
}

// Helper to format numbers with scientific notation for large values
function formatNumber(num?: number): string {
  if (!num) {
    return '-'
  }
  if (num >= 1e11) {
    // Remove the '+' sign from the exponent part
    return num.toExponential(2).replace('+', '')
  }
  return num.toLocaleString()
}

// Helper function to filter and renumber PVP blinds
function getValidPvpBlinds(pvpBlinds: PvpBlind[]): PvpBlind[] {
  // Filter blinds with non-zero scores
  const validBlinds = pvpBlinds.filter(
    (blind) => blind.logOwnerScore > 0 || blind.opponentScore > 0
  )

  // Renumber the blinds sequentially
  return validBlinds.map((blind, index) => ({
    ...blind,
    blindNumber: index + 1, // Start from 1
  }))
}

function PvpBlindsTable({
  game,
  ownerLabel,
  opponentLabel,
}: {
  game: Game
  ownerLabel: string
  opponentLabel: string
}) {
  const validPvpBlinds = getValidPvpBlinds(game.pvpBlinds)

  if (validPvpBlinds.length === 0) {
    return (
      <p className='text-gray-500 text-sm italic'>
        No PVP blind data recorded.
      </p>
    )
  }

  // Calculate totals
  const totalLogOwnerScore = validPvpBlinds.reduce(
    (sum, blind) => sum + blind.logOwnerScore,
    0
  )
  const totalOpponentScore = validPvpBlinds.reduce(
    (sum, blind) => sum + blind.opponentScore,
    0
  )

  // Determine overall winner
  const overallWinner =
    totalLogOwnerScore > totalOpponentScore
      ? 'logOwner'
      : totalOpponentScore > totalLogOwnerScore
        ? 'opponent'
        : null

  return (
    <TableShell className='overflow-hidden'>
      <div className='overflow-x-auto'>
        <Table>
          <TableHeader className='sticky top-0 z-10 bg-background'>
            <TableRow className='bg-muted/50'>
              <TableHead className='w-[60px] text-right font-mono'>
                Blind
              </TableHead>
              <TableHead className='text-right font-mono'>
                {ownerLabel}
              </TableHead>
              <TableHead className='text-right font-mono'>
                {opponentLabel}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {validPvpBlinds.map((blind) => (
              <TableRow key={blind.blindNumber}>
                <TableCell className='text-right font-mono'>
                  {blind.blindNumber}
                  {blind.winner === 'logOwner' ? ' 🏆' : ''}
                  {blind.winner === 'opponent' ? ' 💀' : ''}
                </TableCell>
                <TableCell className='text-right font-mono'>
                  {formatNumber(blind.logOwnerScore)}
                </TableCell>
                <TableCell className='text-right font-mono'>
                  {formatNumber(blind.opponentScore)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className='border-t-2 font-bold'>
              <TableCell className='text-right font-mono'>Total</TableCell>
              <TableCell className='text-right font-mono'>
                {formatNumber(totalLogOwnerScore)}
                {overallWinner === 'logOwner' ? ' 🏆' : ''}
              </TableCell>
              <TableCell className='text-right font-mono'>
                {formatNumber(totalOpponentScore)}
                {overallWinner === 'opponent' ? ' 🏆' : ''}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </TableShell>
  )
}

function PvpHandScoresTable({
  blind,
  ownerLabel,
  opponentLabel,
}: {
  blind: PvpBlind
  ownerLabel: string
  opponentLabel: string
}) {
  const { handScores } = blind

  if (handScores.length === 0) {
    return (
      <p className='text-gray-500 text-sm italic'>
        No hand score data recorded.
      </p>
    )
  }

  // Sort hand scores by timestamp to maintain chronological order
  const sortedHandScores = [...handScores].sort((a, b) => {
    const aTime =
      a.timestamp instanceof Date
        ? a.timestamp.getTime()
        : new Date(a.timestamp).getTime()
    const bTime =
      b.timestamp instanceof Date
        ? b.timestamp.getTime()
        : new Date(b.timestamp).getTime()
    return aTime - bTime
  })

  // Group hand scores by player and filter out zero scores
  const logOwnerScores = sortedHandScores.filter((score) => score.isLogOwner)
  const opponentScores = sortedHandScores.filter(
    (score) => !score.isLogOwner && score.gainedScore > 0
  )

  // Determine the maximum number of hands
  const maxHands = Math.max(logOwnerScores.length, opponentScores.length)

  // Create an array of hand numbers
  const handNumbers = Array.from({ length: maxHands }, (_, i) => i + 1)

  // Calculate total scores
  const totalLogOwnerScore = logOwnerScores.reduce(
    (sum, score) => sum + score.gainedScore,
    0
  )
  const totalOpponentScore = opponentScores.reduce(
    (sum, score) => sum + score.gainedScore,
    0
  )

  return (
    <TableShell className='overflow-hidden'>
      <div className='overflow-x-auto'>
        <Table>
          <TableHeader className='sticky top-0 z-10 bg-background'>
            <TableRow className='bg-muted/50'>
              <TableHead className='w-[60px] text-right font-mono'>
                Hand #
              </TableHead>
              <TableHead className='text-right font-mono'>
                {ownerLabel}
              </TableHead>
              <TableHead className='text-right font-mono'>
                {opponentLabel}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {handNumbers.map((handNumber, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Simple table rendering
              <TableRow key={index}>
                <TableCell className='text-right font-mono'>
                  {handNumber}
                </TableCell>
                <TableCell className='text-right font-mono'>
                  {index < logOwnerScores.length
                    ? formatNumber(logOwnerScores[index]?.gainedScore)
                    : '-'}
                </TableCell>
                <TableCell className='text-right font-mono'>
                  {index < opponentScores.length
                    ? formatNumber(opponentScores[index]?.gainedScore)
                    : '-'}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className='font-bold'>
              <TableCell className='text-right font-mono'>Total</TableCell>
              <TableCell className='text-right font-mono'>
                {formatNumber(totalLogOwnerScore)}
              </TableCell>
              <TableCell className='text-right font-mono'>
                {formatNumber(totalOpponentScore)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </TableShell>
  )
}

export function PvpBlindsCard({
  game,
  ownerLabel,
  opponentLabel,
}: {
  game: Game
  ownerLabel: string
  opponentLabel: string
}) {
  const validPvpBlinds = getValidPvpBlinds(game.pvpBlinds)

  if (validPvpBlinds.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-lg'>PVP Blinds</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        <PvpBlindsTable
          game={game}
          ownerLabel={ownerLabel}
          opponentLabel={opponentLabel}
        />

        {/* Hand Scores for each blind */}
        {validPvpBlinds.map((blind) => (
          <div key={blind.blindNumber} className='mt-4'>
            <h4 className='mb-2 font-semibold'>
              {(() => {
                const scoreDiff = Math.abs(
                  blind.logOwnerScore - blind.opponentScore
                )
                let title = `Blind #${blind.blindNumber} Hand Scores`

                if (blind.winner === 'logOwner') {
                  title += ` (${ownerLabel} won by ${formatNumber(scoreDiff)} chips)`
                } else if (blind.winner === 'opponent') {
                  title += ` (${opponentLabel} won by ${formatNumber(scoreDiff)} chips)`
                }

                return title
              })()}
            </h4>
            <PvpHandScoresTable
              blind={blind}
              ownerLabel={ownerLabel}
              opponentLabel={opponentLabel}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
