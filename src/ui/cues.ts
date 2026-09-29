/**
 * Turns a state change into sound cues. Pure, so it is unit tested.
 * Every device runs the same rules against the same published state.
 */

import type { RoomState, RoundState } from '../game/types'
import type { Cue } from './sound'

export type Snapshot = {
  roster: RoomState | null
  round: RoundState | null
}

export function cuesFor(prev: Snapshot, next: Snapshot, meId: string): Cue[] {
  const cues: Cue[] = []
  const before = prev.roster
  const after = next.roster

  if (before && after) {
    if (after.players.length > before.players.length) cues.push('join')
    if (after.status === 'game_over' && before.status !== 'game_over') cues.push('over')
  }

  const wasRound = prev.round
  const isRound = next.round
  if (!isRound) return cues

  // A new board starts fresh. Only the turn matters there.
  if (!wasRound || wasRound.roundId !== isRound.roundId) {
    if (isRound.turnPlayerId === meId) cues.push('turn')
    return cues
  }

  if (isRound.outcome !== 'running' && wasRound.outcome === 'running') {
    cues.push(isRound.outcome === 'won' && isRound.winnerId === meId ? 'win' : 'lose')
    return cues
  }

  if (isRound.moves.length > wasRound.moves.length) cues.push('hit')
  if (isRound.turnPlayerId === meId && wasRound.turnPlayerId !== meId) cues.push('turn')
  return cues
}
