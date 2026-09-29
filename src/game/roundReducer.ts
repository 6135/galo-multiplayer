/** Board rules. Pure. The host is the only writer of this state. */

import { nextTurn } from './order'
import type { Player, RoundState } from './types'

export const MIN_WIN_LENGTH = 3
export const MAX_WIN_LENGTH = 6

export type Move = { playerId: string; cell: number; expected: number }

export type MoveRejection =
  | 'finished'
  | 'not_your_turn'
  | 'stale'
  | 'out_of_range'
  | 'taken'

/** The win length can never be longer than a side of the grid. */
export function effectiveWinLength(wanted: number, size: number): number {
  const clamped = Math.min(MAX_WIN_LENGTH, Math.max(MIN_WIN_LENGTH, Math.round(wanted)))
  return Math.min(clamped, size)
}

export function createRound(args: {
  roundId: string
  roundNumber: number
  size: number
  winLength: number
  starterId: string | null
}): RoundState {
  return {
    v: 1,
    seq: 0,
    ts: 0,
    src: '',
    roundId: args.roundId,
    roundNumber: args.roundNumber,
    size: args.size,
    winLength: effectiveWinLength(args.winLength, args.size),
    cells: Array.from({ length: args.size * args.size }, () => null),
    moves: [],
    turnPlayerId: args.starterId,
    outcome: 'running',
    winnerId: null,
    line: [],
  }
}

const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, 1], // row
  [1, 0], // column
  [1, 1], // diagonal
  [1, -1], // anti diagonal
]

/**
 * The line of `winLength` equal marks through `cell`, or null.
 * Only the last move can complete a line, so the check starts there.
 */
export function findLine(
  cells: readonly (string | null)[],
  size: number,
  winLength: number,
  cell: number,
): number[] | null {
  const owner = cells[cell]
  if (owner === null || owner === undefined) return null
  const row = Math.floor(cell / size)
  const col = cell % size

  for (const [dr, dc] of DIRECTIONS) {
    const line = [cell]
    for (const sign of [1, -1]) {
      let r = row + dr * sign
      let c = col + dc * sign
      while (r >= 0 && r < size && c >= 0 && c < size && cells[r * size + c] === owner) {
        line.push(r * size + c)
        r += dr * sign
        c += dc * sign
      }
    }
    if (line.length >= winLength) return line.sort((a, b) => a - b)
  }
  return null
}

/** Validates one move. Returns a rejection, or null when the move is legal. */
export function checkMove(state: RoundState, move: Move): MoveRejection | null {
  if (state.outcome !== 'running') return 'finished'
  if (move.playerId !== state.turnPlayerId) return 'not_your_turn'
  if (move.expected !== state.moves.length) return 'stale'
  if (!Number.isInteger(move.cell) || move.cell < 0 || move.cell >= state.cells.length) {
    return 'out_of_range'
  }
  if (state.cells[move.cell] !== null) return 'taken'
  return null
}

/**
 * Applies a legal move: places the mark, checks the win and the draw, and
 * passes the turn. An illegal move returns the same state object.
 */
export function applyMove(
  state: RoundState,
  move: Move,
  order: readonly string[],
  players: readonly Player[],
): RoundState {
  if (checkMove(state, move) !== null) return state

  const cells = state.cells.slice()
  cells[move.cell] = move.playerId
  const moves = [...state.moves, move.cell]

  const line = findLine(cells, state.size, state.winLength, move.cell)
  if (line) {
    return {
      ...state,
      cells,
      moves,
      outcome: 'won',
      winnerId: move.playerId,
      line,
      turnPlayerId: null,
    }
  }
  if (moves.length === cells.length) {
    return { ...state, cells, moves, outcome: 'draw', turnPlayerId: null }
  }
  return { ...state, cells, moves, turnPlayerId: nextTurn(order, players, move.playerId) }
}

/** Passes the turn without a move. The host uses it when the player on turn is gone. */
export function skipTurn(
  state: RoundState,
  order: readonly string[],
  players: readonly Player[],
): RoundState {
  if (state.outcome !== 'running') return state
  const turnPlayerId = nextTurn(order, players, state.turnPlayerId)
  if (turnPlayerId === state.turnPlayerId) return state
  return { ...state, turnPlayerId }
}
