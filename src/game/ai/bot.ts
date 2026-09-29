/** Turns the published board into a request for the search. Pure. */

import { EMPTY, type AiRequest } from './mcts'
import type { BotLevel, Player, RoundState } from '../types'

/** Iterations follow the original agent: 250 is its default. */
export const LEVELS: Record<
  BotLevel,
  { iterations: number; timeMs: number; forks: boolean; label: string }
> = {
  easy: { iterations: 25, timeMs: 150, forks: false, label: 'fácil' },
  normal: { iterations: 250, timeMs: 700, forks: true, label: 'normal' },
  hard: { iterations: 3000, timeMs: 1500, forks: true, label: 'difícil' },
}

/**
 * The search rotates seats as 0, 1, ... N-1. Only the connected players of the
 * frozen order take a seat, in order, because the turn skips everybody else.
 * The mark of a player who left gets a seat that never moves, so it still blocks.
 */
export function toRequest(
  round: RoundState,
  order: readonly string[],
  players: readonly Player[],
  botId: string,
  level: BotLevel,
): AiRequest {
  const connected = new Set(players.filter((player) => player.connected).map((player) => player.id))
  const active = order.filter((id) => connected.has(id) || id === botId)
  const seat = new Map<string, number>()
  active.forEach((id, index) => seat.set(id, index))
  let spare = active.length
  const cells = round.cells.map((owner) => {
    if (owner === null) return EMPTY
    let value = seat.get(owner)
    if (value === undefined) {
      value = spare
      seat.set(owner, spare)
      spare += 1
    }
    return value
  })
  return {
    size: round.size,
    winLength: round.winLength,
    cells,
    players: active.length,
    toMove: seat.get(botId)!,
    iterations: LEVELS[level].iterations,
    timeMs: LEVELS[level].timeMs,
    forks: LEVELS[level].forks,
    // One tree per bot and round. A new round never reads an old tree.
    memoryKey: `${botId}:${round.roundId}`,
  }
}
