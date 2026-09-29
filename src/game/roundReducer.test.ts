import { describe, expect, it } from 'vitest'
import { applyMove, checkMove, createRound, effectiveWinLength, findLine, skipTurn } from './roundReducer'
import type { Player } from './types'

const players = (ids: string[], offline: string[] = []): Player[] =>
  ids.map((id) => ({ id, name: id, score: 0, connected: !offline.includes(id), symbol: '' }))

function round(size: number, winLength = 3, starterId = 'a') {
  return createRound({ roundId: 'r1', roundNumber: 1, size, winLength, starterId })
}

/** Plays a list of cells in turn order. */
function playAll(cells: number[], order: string[], size: number, winLength = 3) {
  const people = players(order)
  let state = round(size, winLength, order[0]!)
  for (const cell of cells) {
    state = applyMove(
      state,
      { playerId: state.turnPlayerId!, cell, expected: state.moves.length },
      order,
      people,
    )
  }
  return state
}

describe('the board', () => {
  it('starts empty with the starter on turn', () => {
    const state = round(4)
    expect(state.cells).toHaveLength(16)
    expect(state.cells.every((cell) => cell === null)).toBe(true)
    expect(state.turnPlayerId).toBe('a')
  })

  it('never asks for a line longer than the grid', () => {
    expect(effectiveWinLength(5, 3)).toBe(3)
    expect(effectiveWinLength(4, 6)).toBe(4)
    expect(effectiveWinLength(1, 6)).toBe(3)
  })

  it('finds a row, a column and both diagonals', () => {
    const c = (list: number[], size: number) => {
      const cells: (string | null)[] = Array.from({ length: size * size }, () => null)
      for (const i of list) cells[i] = 'a'
      return cells
    }
    expect(findLine(c([0, 1, 2], 3), 3, 3, 1)).toEqual([0, 1, 2])
    expect(findLine(c([1, 4, 7], 3), 3, 3, 7)).toEqual([1, 4, 7])
    expect(findLine(c([0, 4, 8], 3), 3, 3, 4)).toEqual([0, 4, 8])
    expect(findLine(c([2, 4, 6], 3), 3, 3, 2)).toEqual([2, 4, 6])
    expect(findLine(c([0, 1, 3], 3), 3, 3, 3)).toBe(null)
  })

  it('does not join a line across the edge of the grid', () => {
    // Cells 2, 3, 4 on a 3x3 grid sit on two rows.
    const cells: (string | null)[] = Array.from({ length: 9 }, () => null)
    cells[2] = 'a'
    cells[3] = 'a'
    cells[4] = 'a'
    expect(findLine(cells, 3, 3, 3)).toBe(null)
  })

  it('plays classic tic-tac-toe to a win', () => {
    // a: 0, 1, 2 · b: 3, 4
    const state = playAll([0, 3, 1, 4, 2], ['a', 'b'], 3)
    expect(state.outcome).toBe('won')
    expect(state.winnerId).toBe('a')
    expect(state.line).toEqual([0, 1, 2])
    expect(state.turnPlayerId).toBe(null)
  })

  it('ends in a draw on a full board', () => {
    // X O X / X O O / O X X
    const state = playAll([0, 1, 2, 4, 3, 5, 7, 6, 8], ['a', 'b'], 3)
    expect(state.outcome).toBe('draw')
    expect(state.winnerId).toBe(null)
  })

  it('rotates three players on a 4x4 grid', () => {
    const order = ['a', 'b', 'c']
    const state = playAll([0, 5, 10], order, 4)
    expect(state.cells[0]).toBe('a')
    expect(state.cells[5]).toBe('b')
    expect(state.cells[10]).toBe('c')
    expect(state.turnPlayerId).toBe('a')
    expect(state.outcome).toBe('running')
  })

  it('refuses an illegal move and keeps the same state object', () => {
    const order = ['a', 'b']
    const people = players(order)
    const state = applyMove(round(3), { playerId: 'a', cell: 4, expected: 0 }, order, people)
    expect(checkMove(state, { playerId: 'a', cell: 0, expected: 1 })).toBe('not_your_turn')
    expect(checkMove(state, { playerId: 'b', cell: 4, expected: 1 })).toBe('taken')
    expect(checkMove(state, { playerId: 'b', cell: 0, expected: 0 })).toBe('stale')
    expect(checkMove(state, { playerId: 'b', cell: 9, expected: 1 })).toBe('out_of_range')
    expect(checkMove(state, { playerId: 'b', cell: 1.5, expected: 1 })).toBe('out_of_range')
    const same = applyMove(state, { playerId: 'b', cell: 4, expected: 1 }, order, people)
    expect(same).toBe(state)
  })

  it('refuses a move after the end', () => {
    const state = playAll([0, 3, 1, 4, 2], ['a', 'b'], 3)
    expect(checkMove(state, { playerId: 'b', cell: 8, expected: 5 })).toBe('finished')
  })

  it('passes the turn over a player who is gone', () => {
    const order = ['a', 'b', 'c']
    const people = players(order, ['b'])
    const state = applyMove(round(4), { playerId: 'a', cell: 0, expected: 0 }, order, people)
    expect(state.turnPlayerId).toBe('c')
  })

  it('skips the turn of a player who left', () => {
    const order = ['a', 'b', 'c']
    const state = skipTurn(round(4), order, players(order, ['a']))
    expect(state.turnPlayerId).toBe('b')
  })
})
