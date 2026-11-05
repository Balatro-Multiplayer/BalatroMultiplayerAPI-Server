import { describe, expect, test } from 'bun:test'
import {
  type LobbyPlayer,
  isDisconnected,
  kickTargetId,
  lobbyActions,
  lobbyJobLabel,
  matchHref,
  playerHref,
  stillInLobby,
} from './lobby-bar'

const p = (over: Partial<LobbyPlayer> = {}): LobbyPlayer => ({
  id: 'n1',
  playerId: 'p1',
  displayName: 'SWIM',
  connected: true,
  ...over,
})

describe('lobby actions', () => {
  test('close alone, then kick with close', () => {
    expect(lobbyActions(null).map((a) => a.key)).toEqual(['close'])
    expect(lobbyActions('SWIM').map((a) => a.key)).toEqual(['kick', 'close'])
  })
  test('labels name the target', () => {
    expect(lobbyJobLabel('kick', 'BG1MB', 'SWIM')).toBe('Kick SWIM from BG1MB')
    expect(lobbyJobLabel('close', 'BG1MB', null)).toBe('Close lobby BG1MB')
  })
})

describe('players', () => {
  test('kick uses the site player id when known', () => {
    expect(kickTargetId(p())).toBe('p1')
    expect(kickTargetId(p({ playerId: null }))).toBe('n1')
  })
  test('away is not connected', () => {
    expect(isDisconnected(p({ connected: false }))).toBe(true)
    expect(isDisconnected(p())).toBe(false)
  })
  test('links', () => {
    expect(playerHref(p())).toBe('/admin/players/p1')
    expect(playerHref(p({ playerId: null }))).toBeNull()
    expect(matchHref('r1')).toBe('/matches/r1')
    expect(matchHref(null)).toBeNull()
  })
  test('a picked player who left is dropped', () => {
    expect(stillInLobby('n1', [p()])).toBe('n1')
    expect(stillInLobby('n2', [p()])).toBeNull()
    expect(stillInLobby(null, [p()])).toBeNull()
  })
})
