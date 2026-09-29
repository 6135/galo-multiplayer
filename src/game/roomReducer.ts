/** Room rules. Pure. The host is the only writer of this state. */

import { MAX_PLAYERS, MIN_PLAYERS, SYMBOLS } from './order'
import { MAX_WIN_LENGTH, MIN_WIN_LENGTH } from './roundReducer'
import type { LastRound, Player, RoomConfig, RoomState, RoundRecord } from './types'

/** The roster travels on every change, so the history cannot grow forever. */
export const HISTORY_LIMIT = 50

export type RoomEvent =
  | { type: 'join'; playerId: string; name: string }
  | { type: 'presence'; playerId: string; online: boolean }
  | { type: 'config'; patch: Partial<RoomConfig> }
  | { type: 'start_game'; order: string[] }
  | { type: 'start_round' }
  | {
      type: 'round_end'
      winnerId: string | null
      draw: boolean
      size: number
      moves: number
      starterId: string | null
    }
  | { type: 'void_round'; size: number; moves: number; starterId: string | null }
  | { type: 'end_game' }
  | { type: 'restart' }

export const DEFAULT_CONFIG: RoomConfig = {
  winLength: 3,
  onePassLimit: false,
}

export function createRoomState(args: {
  hostId: string
  hostPlayerId: string
  hostName: string
  config?: Partial<RoomConfig>
}): RoomState {
  return {
    v: 1,
    seq: 0,
    ts: 0,
    src: args.hostId,
    status: 'lobby',
    hostId: args.hostId,
    hostPlayerId: args.hostPlayerId,
    config: { ...DEFAULT_CONFIG, ...args.config },
    players: [
      { id: args.hostPlayerId, name: args.hostName, score: 0, connected: true, symbol: '' },
    ],
    order: [],
    roundNumber: 0,
    lastRound: null,
    history: [],
  }
}

function nameOf(players: readonly Player[], id: string | null): string | null {
  if (id === null) return null
  return players.find((player) => player.id === id)?.name ?? null
}

function remember(state: RoomState, record: RoundRecord): RoundRecord[] {
  return [...state.history, record].slice(-HISTORY_LIMIT)
}

function withPlayers(state: RoomState, players: Player[]): RoomState {
  return { ...state, players }
}

function cleanName(name: string): string {
  return name.trim().slice(0, 24)
}

export function roomReducer(state: RoomState, event: RoomEvent): RoomState {
  switch (event.type) {
    case 'join': {
      const name = cleanName(event.name) || 'jogador'
      const existing = state.players.find((player) => player.id === event.playerId)
      if (existing) {
        // A repeated join updates the name and does not add a row.
        return withPlayers(
          state,
          state.players.map((player) =>
            player.id === event.playerId ? { ...player, name, connected: true } : player,
          ),
        )
      }
      // The frozen order and the grid cannot accept a new member, so no late join.
      if (state.status !== 'lobby') return state
      if (state.players.length >= MAX_PLAYERS) return state
      return withPlayers(state, [
        ...state.players,
        { id: event.playerId, name, score: 0, connected: true, symbol: '' },
      ])
    }

    case 'presence': {
      const player = state.players.find((row) => row.id === event.playerId)
      if (!player || player.connected === event.online) return state
      return withPlayers(
        state,
        state.players.map((row) =>
          row.id === event.playerId ? { ...row, connected: event.online } : row,
        ),
      )
    }

    case 'config': {
      if (state.status !== 'lobby') return state
      const winLength = event.patch.winLength ?? state.config.winLength
      return {
        ...state,
        config: {
          ...state.config,
          ...event.patch,
          winLength: Math.min(MAX_WIN_LENGTH, Math.max(MIN_WIN_LENGTH, Math.round(winLength))),
        },
      }
    }

    case 'start_game': {
      if (state.status !== 'lobby') return state
      const known = new Set(state.players.map((player) => player.id))
      const order = event.order.filter((id) => known.has(id)).slice(0, MAX_PLAYERS)
      if (order.length < MIN_PLAYERS) return state
      // The seat in the frozen order gives the symbol. A player outside the
      // order (not connected at the start) stays a spectator.
      const players = state.players.map((player) => {
        const seat = order.indexOf(player.id)
        return { ...player, symbol: seat === -1 ? '' : SYMBOLS[seat]! }
      })
      return { ...state, status: 'playing', order, players, roundNumber: 1, lastRound: null }
    }

    case 'start_round': {
      if (state.status !== 'round_end') return state
      const roundNumber = state.roundNumber + 1
      if (state.config.onePassLimit && roundNumber > state.order.length) {
        return { ...state, status: 'game_over' }
      }
      return { ...state, status: 'playing', roundNumber }
    }

    case 'round_end': {
      if (state.status !== 'playing') return state
      const winner = state.players.find((player) => player.id === event.winnerId)
      const scores =
        winner && !event.draw
          ? state.players.map((player) =>
              player.id === winner.id ? { ...player, score: player.score + 1 } : player,
            )
          : state.players
      const lastRound: LastRound = {
        winnerId: winner && !event.draw ? winner.id : null,
        draw: event.draw,
        voided: false,
      }
      const passDone = state.config.onePassLimit && state.roundNumber >= state.order.length
      return {
        ...state,
        players: scores,
        status: passDone ? 'game_over' : 'round_end',
        lastRound,
        history: remember(state, {
          n: state.roundNumber,
          size: event.size,
          moves: event.moves,
          starterName: nameOf(state.players, event.starterId) ?? '—',
          winnerId: lastRound.winnerId,
          winnerName: nameOf(state.players, lastRound.winnerId),
          draw: event.draw,
          voided: false,
        }),
      }
    }

    case 'void_round': {
      if (state.status !== 'playing') return state
      return {
        ...state,
        status: 'round_end',
        lastRound: { winnerId: null, draw: false, voided: true },
        history: remember(state, {
          n: state.roundNumber,
          size: event.size,
          moves: event.moves,
          starterName: nameOf(state.players, event.starterId) ?? '—',
          winnerId: null,
          winnerName: null,
          draw: false,
          voided: true,
        }),
      }
    }

    case 'end_game':
      return state.status === 'lobby' ? state : { ...state, status: 'game_over' }

    case 'restart': {
      // Back to the lobby with the same people. The scores go to zero, the
      // order and the symbols are dropped, so the next start draws new ones.
      if (state.status === 'lobby') return state
      return {
        ...state,
        status: 'lobby',
        players: state.players.map((player) => ({ ...player, score: 0, symbol: '' })),
        order: [],
        roundNumber: 0,
        lastRound: null,
        history: [],
      }
    }

    default:
      return state
  }
}

/** The ranking. Sorted by score, then by name. */
export function ranking(players: readonly Player[]): Player[] {
  return players.slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
}
