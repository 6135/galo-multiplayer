import { describe, expect, it } from 'vitest'
import { gridSize, nextTurn, randomBelow, shuffle, starterForRound } from './order'
import type { Player } from './types'

const players = (ids: string[], offline: string[] = []): Player[] =>
  ids.map((id) => ({ id, name: id, score: 0, connected: !offline.includes(id), symbol: '' }))

describe('the order', () => {
  it('grows the grid with the players', () => {
    expect(gridSize(2)).toBe(3)
    expect(gridSize(3)).toBe(4)
    expect(gridSize(12)).toBe(13)
    expect(gridSize(1)).toBe(3)
  })

  it('keeps every item in a shuffle', () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    expect(shuffle(items).sort()).toEqual(items)
  })

  it('draws inside the bound', () => {
    for (let i = 0; i < 200; i += 1) {
      const value = randomBelow(7)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(7)
    }
  })

  it('rotates the starter each round and skips a player who is gone', () => {
    const order = ['a', 'b', 'c']
    expect(starterForRound(order, players(order), 1)).toBe('a')
    expect(starterForRound(order, players(order), 2)).toBe('b')
    expect(starterForRound(order, players(order), 4)).toBe('a')
    expect(starterForRound(order, players(order, ['b']), 2)).toBe('c')
    expect(starterForRound(order, players(order, ['a', 'b', 'c']), 1)).toBe(null)
  })

  it('wraps the turn around the order', () => {
    const order = ['a', 'b', 'c']
    expect(nextTurn(order, players(order), 'c')).toBe('a')
    expect(nextTurn(order, players(order, ['a']), 'c')).toBe('b')
  })
})
