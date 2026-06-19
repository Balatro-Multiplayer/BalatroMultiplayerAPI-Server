'use client'

import Link from 'next/link'
import { useFormatter, useTimeZone } from 'next-intl'
import { parseAsString, useQueryStates } from 'nuqs'
import { type FormEvent, Suspense, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { api } from '@/trpc/react'

function normalizeLobbyCodeLikeMod(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 5)
}

export function LobbyCodesClient({
  canViewTranscripts,
}: {
  canViewTranscripts: boolean
}) {
  const [queryParams, setQueryParams] = useQueryStates(
    {
      search: parseAsString,
    },
    { history: 'push' }
  )

  const searchQuery = queryParams.search ?? ''
  const [draftQuery, setDraftQuery] = useState(searchQuery)

  const normalizedDraftQuery = useMemo(
    () => normalizeLobbyCodeLikeMod(draftQuery),
    [draftQuery]
  )

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void setQueryParams({ search: normalizedDraftQuery || null })
  }

  return (
    <div className='space-y-4'>
      <form className='flex flex-col gap-3 sm:flex-row' onSubmit={onSubmit}>
        <Input
          value={draftQuery}
          onChange={(event) => setDraftQuery(event.target.value)}
          placeholder='Enter a lobby code'
          className='sm:max-w-sm'
        />
        <Button type='submit' disabled={normalizedDraftQuery.length === 0}>
          Search
        </Button>
      </form>

      <p className='text-fd-muted-foreground text-sm'>
        Search is normalized like the mod join flow: letters only, uppercase,
        first 5. Shorter input runs a prefix search.
      </p>

      <div className='overflow-x-auto rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Match</TableHead>
              <TableHead>Players</TableHead>
              <TableHead>Queue</TableHead>
              <TableHead>Matched</TableHead>
              <TableHead>All Codes</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Transcript</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {searchQuery.length > 0 ? (
              <Suspense
                fallback={
                  <TableRow>
                    <TableCell colSpan={7} className='text-fd-muted-foreground'>
                      Loading...
                    </TableCell>
                  </TableRow>
                }
              >
                <LobbyCodesResults
                  query={searchQuery}
                  canViewTranscripts={canViewTranscripts}
                />
              </Suspense>
            ) : (
              <TableRow>
                <TableCell colSpan={7} className='text-fd-muted-foreground'>
                  Enter a code to search.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function LobbyCodesResults({
  query,
  canViewTranscripts,
}: {
  query: string
  canViewTranscripts: boolean
}) {
  const formatter = useFormatter()
  const timeZone = useTimeZone()

  const [search] = api.history.searchTranscriptLobbyCodes.useSuspenseQuery({
    query,
    limit: 50,
  })

  return (
    <>
      {search.results.length > 0 ? (
        search.results.map((result) => (
          <TableRow key={result.match_id}>
            <TableCell className='font-medium'>{result.match_id}</TableCell>
            <TableCell>
              <div className='flex min-w-52 flex-col gap-1'>
                {result.players.map((player) => (
                  <Link
                    key={player.user_id}
                    href={`/players/${player.user_id}`}
                    className='text-primary underline-offset-4 hover:underline'
                  >
                    {player.display_name ?? player.user_id}
                  </Link>
                ))}
              </div>
            </TableCell>
            <TableCell>{result.queue_name ?? '-'}</TableCell>
            <TableCell>{result.matched_codes.join(', ')}</TableCell>
            <TableCell>{result.lobby_codes.join(', ')}</TableCell>
            <TableCell>
              {formatter.dateTime(new Date(result.created_at), {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone,
              })}
            </TableCell>
            <TableCell>
              {canViewTranscripts ? (
                <Link
                  href={`/transcript/${result.match_id}`}
                  className='text-primary underline-offset-4 hover:underline'
                  target='_blank'
                  rel='noreferrer'
                >
                  Open
                </Link>
              ) : (
                '-'
              )}
            </TableCell>
          </TableRow>
        ))
      ) : (
        <TableRow>
          <TableCell colSpan={7} className='text-fd-muted-foreground'>
            No matches found.
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
