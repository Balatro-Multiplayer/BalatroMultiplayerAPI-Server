'use client'

import { SettingsIcon, X } from 'lucide-react'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { useLocalStorage } from 'usehooks-ts'
import { v4 } from 'uuid'
import { getPlayerData } from '@/app/stream-card/[id]/_components/stream-card-client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { OBSController } from '@/lib/obs-connection'
import { RANKED_QUEUE_ID } from '@/shared/constants'
import { filterGamesBySeason, getActiveSeason } from '@/shared/seasons'
import { api } from '@/trpc/react'
import { PlayerSelector } from './player-selector'

const obs = new OBSController()

type Commentator = {
  id: string
  name: string
}

export function ObsControlPanelClient() {
  useEffect(() => {
    if (window.location.protocol === 'https:') {
      toast.error('OBS controls require HTTP', {
        description: 'Please use http:// version of the site for OBS controls',
      })
    }
  }, [])
  const [isConnected, setIsConnected] = useState(false)
  const [commentators, _setCommentators] = useLocalStorage<Commentator[]>(
    'commentators',
    []
  )
  const players = api.leaderboard.get_leaderboard.useQuery({
    channel_id: RANKED_QUEUE_ID,
  })
  const seasonsQuery = api.seasons.list.useQuery()
  const activeSeason = getActiveSeason(seasonsQuery.data)

  const playersForSelect = players.data?.data?.map((player) => ({
    value: player.id,
    label: player.name,
  }))
  const [open, setOpen] = React.useState(false)
  const [open2, setOpen2] = React.useState(false)
  const [value1, setValue1] = React.useState('')
  const [value2, setValue2] = React.useState('')
  const form = useForm({
    defaultValues: {
      player1Name: '',
      player2Name: '',
      player1Mmr: '0',
      player2Mmr: '0',
      player1Games: '0',
      player2Games: '0',
      player1Wins: '0',
      player2Wins: '0',
      player1Losses: '0',
      player2Losses: '0',
      player1Rank: '0',
      player2Rank: '0',
      player1WinRate: '0',
      player2WinRate: '0',
      commentator1: '',
      commentator2: '',
    },
  })
  const { setValue } = form
  const { data: player1Games } = api.history.user_games.useQuery(
    {
      user_id: value1 ?? '',
    },
    { enabled: !!value1 }
  )
  const { data: player2Games } = api.history.user_games.useQuery(
    {
      user_id: value2 ?? '',
    },
    { enabled: !!value2 }
  )
  const { data: player1Info } = api.leaderboard.get_user_rank.useQuery(
    {
      channel_id: RANKED_QUEUE_ID,
      user_id: value1 ?? '',
      season: activeSeason ?? undefined,
    },
    { enabled: !!value1 }
  )
  const { data: player2Info } = api.leaderboard.get_user_rank.useQuery(
    {
      channel_id: RANKED_QUEUE_ID,
      user_id: value2 ?? '',
      season: activeSeason ?? undefined,
    },
    { enabled: !!value2 }
  )
  const player1SeasonGames = useMemo(
    () =>
      activeSeason && player1Games
        ? filterGamesBySeason(player1Games, activeSeason)
        : [],
    [activeSeason, player1Games]
  )
  const player2SeasonGames = useMemo(
    () =>
      activeSeason && player2Games
        ? filterGamesBySeason(player2Games, activeSeason)
        : [],
    [activeSeason, player2Games]
  )
  const player1Data = useMemo(() => {
    return player1Info && player1Games
      ? getPlayerData(player1Info.data, player1SeasonGames)
      : null
  }, [player1Games, player1Info, player1SeasonGames])
  const player2Data = useMemo(() => {
    return player2Info && player2Games
      ? getPlayerData(player2Info.data, player2SeasonGames)
      : null
  }, [player2Games, player2Info, player2SeasonGames])

  let _winsVsOpponent = 0
  let _lossesVsOpponent = 0
  if (value1 && player1SeasonGames.length && value2) {
    for (const game of player1SeasonGames) {
      if (game.opponentId === value2) {
        if (game.result === 'win') {
          _winsVsOpponent++
        } else if (game.result === 'loss') {
          _lossesVsOpponent++
        }
      }
    }
  }
  useEffect(() => {
    // try to connect on mount
    obs
      .connect()
      .then(() => setIsConnected(true))
      .catch(() => setIsConnected(false))
  }, [])

  useEffect(() => {
    if (!isConnected) return

    if (player1Data) {
      setValue('player1Name', player1Data.username)
      setValue('player1Mmr', player1Data.mmr.toString())
      setValue('player1Games', player1Data.games.toString())
      setValue('player1Wins', player1Data.wins.toString())
      setValue('player1Losses', player1Data.losses.toString())
      setValue('player1Rank', player1Data.rank.toString())
      setValue('player1WinRate', `${player1Data.winRate.toString()}%`)
    }
  }, [isConnected, player1Data, setValue])

  // Effect to update Player 2 form fields when player2 selection or data changes
  useEffect(() => {
    if (!isConnected) return

    if (player2Data) {
      setValue('player2Name', player2Data.username)
      setValue('player2Mmr', player2Data.mmr.toString())
      setValue('player2Games', player2Data.games.toString())
      setValue('player2Wins', player2Data.wins.toString())
      setValue('player2Losses', player2Data.losses.toString())
      setValue('player2Rank', player2Data.rank.toString())
      setValue('player2WinRate', `${player2Data.winRate.toString()}%`)
    }
  }, [isConnected, player2Data, setValue])

  const [mappings] = useLocalStorage<FieldMapping[]>('obs-field-mappings', [])

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      const updates = mappings
        .map((mapping) => {
          const value = data[mapping.formField as keyof typeof data]
          if (!value) return null

          const sanitizedValue = value
            .toString()
            .replace(/[^\p{ASCII}]/gu, '')
            .trim()

          return obs.updateText(mapping.obsSource, sanitizedValue)
        })
        .filter(Boolean) // remove nulls from skipped empty values

      await Promise.all(updates)

      toast.success('Updated OBS text sources', {
        description: `Successfully updated ${updates.length} fields`,
      })
    } catch (error) {
      toast.error('Failed to update OBS', {
        description:
          error instanceof Error ? error.message : 'Unknown error occurred',
      })
    }
  })

  if (!playersForSelect) {
    return <div>Loading...</div>
  }
  return (
    <div
      className={
        'mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-col gap-4 pt-16'
      }
    >
      <div className={'flex w-full justify-end'}>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant={'secondary'}>
              Settings
              <SettingsIcon />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Settings</DialogTitle>
              <DialogDescription>
                Adjust the settings for the OBS controls
              </DialogDescription>
            </DialogHeader>
            <Settings />
          </DialogContent>
        </Dialog>
      </div>
      <div className={'grid grid-cols-2 gap-4'}>
        <PlayerSelector
          value={value1}
          players={playersForSelect}
          onValueChange={setValue1}
          open={open}
          onOpenChange={setOpen}
        />
        <PlayerSelector
          value={value2}
          players={playersForSelect}
          onValueChange={setValue2}
          open={open2}
          onOpenChange={setOpen2}
        />
      </div>
      <form onSubmit={onSubmit}>
        <div className={'grid grid-cols-2 gap-4'}>
          <div>Player 1</div>
          <div>Player 2</div>
          <div className={'grid grid-cols-1 gap-2'}>
            <Label>Name</Label>
            <Input {...form.register('player1Name')} />
          </div>
          <div className={'grid grid-cols-1 gap-2'}>
            <Label>Name</Label>
            <Input {...form.register('player2Name')} />
          </div>
          <div className={'grid grid-cols-1 gap-2'}>
            <Label>MMR</Label>
            <Input {...form.register('player1Mmr')} />
          </div>
          <div className={'grid grid-cols-1 gap-2'}>
            <Label>MMR</Label>
            <Input {...form.register('player2Mmr')} />
          </div>
          <div className={'grid grid-cols-1 gap-2'}>
            <Label>Games</Label>
            <Input {...form.register('player1Games')} />
          </div>
          <div className={'grid grid-cols-1 gap-2'}>
            <Label>Games</Label>
            <Input {...form.register('player2Games')} />
          </div>
          <div className={'grid grid-cols-1 gap-2'}>
            <Label>Wins</Label>
            <Input {...form.register('player1Wins')} />
          </div>
          <div className={'grid grid-cols-1 gap-2'}>
            <Label>Wins</Label>
            <Input {...form.register('player2Wins')} />
          </div>
          <div className={'grid grid-cols-1 gap-2'}>
            <Label>Losses</Label>
            <Input {...form.register('player1Losses')} />
          </div>
          <div className={'grid grid-cols-1 gap-2'}>
            <Label>Losses</Label>
            <Input {...form.register('player2Losses')} />
          </div>
          <div className={'grid grid-cols-1 gap-2'}>
            <Label>Rank</Label>
            <Input {...form.register('player1Rank')} />
          </div>
          <div className={'grid grid-cols-1 gap-2'}>
            <Label>Rank</Label>
            <Input {...form.register('player2Rank')} />
          </div>
          <div className={'grid grid-cols-1 gap-2'}>
            <Label>Win rate</Label>
            <Input {...form.register('player1WinRate')} />
          </div>
          <div className={'grid grid-cols-1 gap-2'}>
            <Label>Win rate</Label>
            <Input {...form.register('player2WinRate')} />
          </div>
        </div>
        <div className={'mt-4 space-y-4'}>
          <h2 className={'text-xl'}>Commentators</h2>
          <div className={'grid grid-cols-1 gap-2'}>
            <Label>Commentator 1</Label>
            <Select
              value={form.watch('commentator1')}
              onValueChange={(value) => form.setValue('commentator1', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder='Select commentator' />
              </SelectTrigger>
              <SelectContent>
                {commentators.map((commentator) => (
                  <SelectItem key={commentator.id} value={commentator.name}>
                    {commentator.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className={'grid grid-cols-1 gap-2'}>
            <Label>Commentator 2</Label>
            <Select
              value={form.watch('commentator2')}
              onValueChange={(value) => form.setValue('commentator2', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder='Select commentator' />
              </SelectTrigger>
              <SelectContent>
                {commentators.map((commentator) => (
                  <SelectItem key={commentator.id} value={commentator.name}>
                    {commentator.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button type={'submit'} className={'mt-4'}>
          Ship it
        </Button>
      </form>
    </div>
  )
}

type FieldMapping = {
  id: string
  formField: string
  obsSource: string
}
type FormField = {
  id: string
  label: string
}
function Settings() {
  const [isLoading, setIsLoading] = useState(true)
  const [obsSources, setObsSources] = useState<string[]>([])
  const [commentators, setCommentators] = useLocalStorage<Commentator[]>(
    'commentators',
    []
  )
  const [newCommentatorName, setNewCommentatorName] = useState('')

  const [mappings, setMappings] = useLocalStorage<FieldMapping[]>(
    'obs-field-mappings',
    []
  )
  const normalizedMappings = useMemo(
    () =>
      mappings.map((mapping) => ({
        id: mapping.id || v4(),
        formField: mapping.formField,
        obsSource: mapping.obsSource,
      })),
    [mappings]
  )
  const formFields: FormField[] = [
    { id: 'player1Name', label: 'Player 1 - Name' },
    { id: 'player2Name', label: 'Player 2 - Name' },
    { id: 'player1Mmr', label: 'Player 1 - MMR' },
    { id: 'player2Mmr', label: 'Player 2 - MMR' },
    { id: 'player1Games', label: 'Player 1 - Games' },
    { id: 'player2Games', label: 'Player 2 - Games' },
    { id: 'player1Wins', label: 'Player 1 - Wins' },
    { id: 'player2Wins', label: 'Player 2 - Wins' },
    { id: 'player1Losses', label: 'Player 1 - Losses' },
    { id: 'player2Losses', label: 'Player 2 - Losses' },
    { id: 'player1Rank', label: 'Player 1 - Rank' },
    { id: 'player2Rank', label: 'Player 2 - Rank' },
    { id: 'player1WinRate', label: 'Player 1 - Win Rate' },
    { id: 'player2WinRate', label: 'Player 2 - Win Rate' },
    { id: 'commentator1', label: 'Commentator 1' },
    { id: 'commentator2', label: 'Commentator 2' },
  ]
  const addCommentator = () => {
    if (newCommentatorName.trim()) {
      setCommentators([
        ...commentators,
        { id: v4(), name: newCommentatorName.trim() },
      ])
      setNewCommentatorName('')
    }
  }

  const removeCommentator = (id: string) => {
    setCommentators(commentators.filter((c) => c.id !== id))
  }

  useEffect(() => {
    async function fetchSources() {
      try {
        const inputs = await obs.getInputs()
        const textSources = inputs
          .filter((input) => input.inputKind.includes('text'))
          .map((input) => input.inputName)
        setObsSources(textSources)
      } catch (error) {
        console.error('Failed to fetch sources:', error)
      } finally {
        setIsLoading(false)
      }
    }
    fetchSources()
  }, [])

  const addMapping = () => {
    setMappings([
      ...normalizedMappings,
      { id: v4(), formField: '', obsSource: '' },
    ])
  }

  const removeMapping = (id: string) => {
    setMappings(normalizedMappings.filter((mapping) => mapping.id !== id))
  }

  const updateMapping = (
    id: string,
    field: 'formField' | 'obsSource',
    value: string
  ) => {
    const newMappings = normalizedMappings.map((mapping) =>
      mapping.id === id ? { ...mapping, [field]: value } : mapping
    )
    setMappings(newMappings)
  }

  if (isLoading) {
    return <div>Loading sources...</div>
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between px-4'>
        <h3 className='font-medium text-lg'>Field Mappings</h3>
        <Button onClick={addMapping} size='sm'>
          Add Mapping
        </Button>
      </div>
      <ScrollArea className='h-[500px] p-4'>
        <div className='space-y-2'>
          {normalizedMappings.map((mapping) => (
            <div key={mapping.id} className='flex items-center gap-2'>
              <Select
                value={mapping.formField}
                onValueChange={(value) =>
                  updateMapping(mapping.id, 'formField', value)
                }
              >
                <SelectTrigger className='w-[200px]'>
                  <SelectValue placeholder='Select field'>
                    {formFields.find((f) => f.id === mapping.formField)
                      ?.label || 'Select field'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {formFields.map((field) => (
                    <SelectItem key={field.id} value={field.id}>
                      {field.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={mapping.obsSource}
                onValueChange={(value) =>
                  updateMapping(mapping.id, 'obsSource', value)
                }
              >
                <SelectTrigger className='w-[200px]'>
                  <SelectValue placeholder='Select OBS source' />
                </SelectTrigger>
                <SelectContent>
                  {obsSources.map((source) => (
                    <SelectItem key={source} value={source}>
                      {source}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant='destructive'
                size='icon'
                onClick={() => removeMapping(mapping.id)}
              >
                <X className='h-4 w-4' />
              </Button>
            </div>
          ))}
        </div>

        {normalizedMappings.length === 0 && (
          <div className='py-4 text-center text-muted-foreground'>
            No mappings configured. Add one to get started.
          </div>
        )}
        <div className='mt-8 space-y-4'>
          <h3 className='font-medium text-lg'>Commentators</h3>

          <div className='flex gap-2'>
            <Input
              value={newCommentatorName}
              onChange={(e) => setNewCommentatorName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  addCommentator()
                  e.preventDefault()
                }
              }}
              placeholder='Enter commentator name'
            />
            <Button onClick={addCommentator}>Add</Button>
          </div>

          <div className='space-y-2'>
            {commentators.map((commentator) => (
              <div
                key={commentator.id}
                className='flex items-center justify-between rounded p-2'
              >
                <span>{commentator.name}</span>
                <Button
                  variant='destructive'
                  size='icon'
                  onClick={() => removeCommentator(commentator.id)}
                >
                  <X className='h-4 w-4' />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
