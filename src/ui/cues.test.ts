import { describe, expect, it } from 'vitest'
import { cuesFor } from './cues'
import { createRound } from '../game/roundReducer'
import type { RoundState } from '../game/types'

const base = createRound({ roundId: 'r1', roundNumber: 1, size: 3, winLength: 3, starterId: 'a' })
const with_ = (patch: Partial<RoundState>): RoundState => ({ ...base, ...patch })

describe('the cues', () => {
  it('rings the turn on a new board', () => {
    expect(cuesFor({ roster: null, round: null }, { roster: null, round: base }, 'a')).toEqual(['turn'])
  })

  it('marks a move and the next turn', () => {
    const next = with_({ moves: [0], turnPlayerId: 'b' })
    expect(cuesFor({ roster: null, round: base }, { roster: null, round: next }, 'b')).toEqual([
      'hit',
      'turn',
    ])
  })

  it('plays a win for the winner and a loss for the rest', () => {
    const done = with_({ moves: [0], outcome: 'won', winnerId: 'a', turnPlayerId: null })
    expect(cuesFor({ roster: null, round: base }, { roster: null, round: done }, 'a')).toEqual(['win'])
    expect(cuesFor({ roster: null, round: base }, { roster: null, round: done }, 'b')).toEqual(['lose'])
  })
})
