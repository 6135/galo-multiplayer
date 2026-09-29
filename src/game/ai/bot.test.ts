import { describe, expect, it } from 'vitest'
import { toRequest } from './bot'
import { EMPTY } from './mcts'
import { createRound } from '../roundReducer'
import type { Player } from '../types'

const player = (id: string, connected = true, bot?: 'normal'): Player => ({
  id,
  name: id,
  score: 0,
  connected,
  symbol: '',
  ...(bot ? { bot } : {}),
})

describe('the bot request', () => {
  it('seats the connected players in order and gives a gone player a seat that never moves', () => {
    const round = createRound({ roundId: 'r', roundNumber: 1, size: 4, winLength: 3, starterId: 'a' })
    round.cells[0] = 'a'
    round.cells[1] = 'b'
    round.cells[2] = 'bot'
    const players = [player('a'), player('b', false), player('bot', true, 'normal')]
    const request = toRequest(round, ['a', 'b', 'bot'], players, 'bot', 'normal')
    expect(request.players).toBe(2)
    expect(request.toMove).toBe(1)
    expect(request.cells.slice(0, 4)).toEqual([0, 2, 1, EMPTY])
  })
})
