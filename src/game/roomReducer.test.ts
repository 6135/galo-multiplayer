import { describe, expect, it } from 'vitest'
import { createRoomState, ranking, roomReducer } from './roomReducer'
import { MAX_PLAYERS } from './order'
import type { RoomState } from './types'

function lobby(): RoomState {
  let state = createRoomState({ hostId: 'h', hostPlayerId: 'a', hostName: 'ana' })
  state = roomReducer(state, { type: 'join', playerId: 'b', name: 'bruno' })
  state = roomReducer(state, { type: 'join', playerId: 'c', name: 'carla' })
  return state
}

function started(): RoomState {
  return roomReducer(lobby(), { type: 'start_game', order: ['c', 'a', 'b'] })
}

const end = (winnerId: string | null, draw = false) =>
  ({ type: 'round_end', winnerId, draw, size: 4, moves: 7, starterId: 'c' }) as const

describe('the room', () => {
  it('adds a player once and updates the name on a repeat', () => {
    let state = lobby()
    state = roomReducer(state, { type: 'join', playerId: 'b', name: 'Bruno' })
    expect(state.players).toHaveLength(3)
    expect(state.players.find((p) => p.id === 'b')?.name).toBe('Bruno')
  })

  it('caps the room at one player per symbol', () => {
    let state = createRoomState({ hostId: 'h', hostPlayerId: 'p0', hostName: 'p0' })
    for (let i = 1; i < MAX_PLAYERS + 3; i += 1) {
      state = roomReducer(state, { type: 'join', playerId: `p${i}`, name: `p${i}` })
    }
    expect(state.players).toHaveLength(MAX_PLAYERS)
  })

  it('gives each seat its own symbol at the start', () => {
    const state = started()
    expect(state.status).toBe('playing')
    expect(state.roundNumber).toBe(1)
    const symbols = state.order.map((id) => state.players.find((p) => p.id === id)?.symbol)
    expect(symbols).toEqual(['X', 'O', '△'])
  })

  it('refuses a late join but lets a known player back in', () => {
    let state = started()
    state = roomReducer(state, { type: 'join', playerId: 'd', name: 'duarte' })
    expect(state.players).toHaveLength(3)
    state = roomReducer(state, { type: 'presence', playerId: 'b', online: false })
    state = roomReducer(state, { type: 'join', playerId: 'b', name: 'bruno' })
    expect(state.players.find((p) => p.id === 'b')?.connected).toBe(true)
  })

  it('needs two players to start', () => {
    const alone = createRoomState({ hostId: 'h', hostPlayerId: 'a', hostName: 'ana' })
    expect(roomReducer(alone, { type: 'start_game', order: ['a'] }).status).toBe('lobby')
  })

  it('scores a win, not a draw', () => {
    let state = roomReducer(started(), end('a'))
    expect(state.status).toBe('round_end')
    expect(state.players.find((p) => p.id === 'a')?.score).toBe(1)
    state = roomReducer(state, { type: 'start_round' })
    expect(state.roundNumber).toBe(2)
    state = roomReducer(state, end(null, true))
    expect(ranking(state.players).map((p) => p.score)).toEqual([1, 0, 0])
    expect(state.history).toHaveLength(2)
    expect(state.history[1]?.draw).toBe(true)
  })

  it('ends after one round per player with the limit on', () => {
    let state = roomReducer(lobby(), { type: 'config', patch: { onePassLimit: true } })
    state = roomReducer(state, { type: 'start_game', order: ['a', 'b', 'c'] })
    for (let i = 0; i < 3; i += 1) {
      state = roomReducer(state, end('a'))
      if (i < 2) state = roomReducer(state, { type: 'start_round' })
    }
    expect(state.status).toBe('game_over')
  })

  it('clamps the win length', () => {
    expect(roomReducer(lobby(), { type: 'config', patch: { winLength: 99 } }).config.winLength).toBe(6)
    expect(roomReducer(lobby(), { type: 'config', patch: { winLength: 0 } }).config.winLength).toBe(3)
  })

  it('voids a round with no point', () => {
    const state = roomReducer(started(), { type: 'void_round', size: 4, moves: 2, starterId: 'c' })
    expect(state.lastRound?.voided).toBe(true)
    expect(state.players.every((p) => p.score === 0)).toBe(true)
  })

  it('restarts in place and drops the symbols', () => {
    const state = roomReducer(roomReducer(started(), end('a')), { type: 'restart' })
    expect(state.status).toBe('lobby')
    expect(state.players).toHaveLength(3)
    expect(state.players.every((p) => p.score === 0 && p.symbol === '')).toBe(true)
    expect(state.order).toEqual([])
  })
})
