/** Frozen turn order, symbols, grid size and turn rotation. */

import type { Player } from './types'

/** One symbol per seat in the frozen order. The length caps the room size. */
export const SYMBOLS = ['X', 'O', '△', '□', '★', '◆', '♣', '♥', '☀', '♠', '☾', '✚'] as const
export const MAX_PLAYERS = SYMBOLS.length
export const MIN_PLAYERS = 2

/** Two players play on 3x3. Each extra player adds one row and one column. */
export function gridSize(playerCount: number): number {
  return Math.max(3, playerCount + 1)
}

/** Fisher-Yates. Every index comes from crypto.getRandomValues. */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomBelow(i + 1)
    const a = out[i]!
    const b = out[j]!
    out[i] = b
    out[j] = a
  }
  return out
}

/** Uniform integer in [0, bound). Rejection sampling removes the modulo bias. */
export function randomBelow(bound: number): number {
  if (bound <= 1) return 0
  const limit = Math.floor(0xffffffff / bound) * bound
  const buffer = new Uint32Array(1)
  let value = 0
  do {
    crypto.getRandomValues(buffer)
    value = buffer[0]!
  } while (value >= limit)
  return value % bound
}

function isConnected(players: readonly Player[], id: string): boolean {
  return players.some((player) => player.id === id && player.connected)
}

/**
 * The player that opens round `roundNumber`. Starts at
 * `order[(roundNumber - 1) % n]` and steps over any player that is not connected.
 */
export function starterForRound(
  order: readonly string[],
  players: readonly Player[],
  roundNumber: number,
): string | null {
  if (order.length === 0 || roundNumber < 1) return null
  const start = (roundNumber - 1) % order.length
  for (let step = 0; step < order.length; step += 1) {
    const id = order[(start + step) % order.length]!
    if (isConnected(players, id)) return id
  }
  return null
}

/** The next connected player after `currentTurnId`. Null when nobody is connected. */
export function nextTurn(
  order: readonly string[],
  players: readonly Player[],
  currentTurnId: string | null,
): string | null {
  if (order.length === 0) return null
  const currentIndex = currentTurnId === null ? -1 : order.indexOf(currentTurnId)
  for (let step = 1; step <= order.length; step += 1) {
    const id = order[(currentIndex + step + order.length) % order.length]!
    if (isConnected(players, id)) return id
  }
  return null
}
