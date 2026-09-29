import { describe, expect, it } from 'vitest'
import { EMPTY, type Board } from './board'
import { scoreCells } from './heuristic'
import { tacticalMove, threatsAfter, winCells } from './tactics'

/** Places marks on an empty board. `marks` maps a seat to its cells. */
function board(size: number, k: number, players: number, marks: Record<number, number[]>): Board {
  const cells = new Int8Array(size * size).fill(EMPTY)
  let filled = 0
  for (const [seat, list] of Object.entries(marks)) {
    for (const cell of list) {
      cells[cell] = Number(seat)
      filled += 1
    }
  }
  return { size, winLength: k, cells, players, filled }
}

describe('the heuristic', () => {
  it('fills the gap of X_X before a cell next to one mark', () => {
    const b = board(5, 3, 2, { 0: [10, 12] })
    const scores = scoreCells(b, 0)
    expect(scores[11]!).toBeGreaterThan(scores[13]!)
    expect(scores[10]).toBe(-1)
  })

  it('gives nothing for a line that nobody can win', () => {
    // Row 0 of a 3x3 holds both seats, so cell 1 lives only on its column.
    const b = board(3, 3, 2, { 0: [0], 1: [2] })
    const withDeadRow = scoreCells(b, 0)[1]!
    const open = scoreCells(board(3, 3, 2, {}), 0)[1]!
    expect(withDeadRow).toBeLessThan(open)
  })
})

describe('the tactics', () => {
  it('finds the win cells of a seat, gap included', () => {
    expect(winCells(board(5, 4, 2, { 0: [0, 1, 3] }), 0)).toEqual([2])
  })

  it('makes an open four from an open three on 9x9, five in a row', () => {
    // Row 4: _ _ _ X X X _ _ _. Both ends make two win cells: a fork.
    const b = board(9, 5, 2, { 0: [39, 40, 41], 1: [0, 80] })
    expect([38, 42]).toContain(tacticalMove(b, 0, true))
  })

  it('blocks an open three on 9x9, five in a row', () => {
    const b = board(9, 5, 2, { 0: [39, 40, 41], 1: [0, 80] })
    expect([38, 42]).toContain(tacticalMove(b, 1, true))
  })

  it('blocks the player further away when the next player has no threat', () => {
    const b = board(5, 3, 3, { 1: [24], 2: [0, 1] })
    expect(tacticalMove(b, 0, true)).toBe(2)
  })

  it('needs one winning cell per other player for a fork', () => {
    // Marks at 0 and 11. Cell 12 opens three lines: 0-6-12, 10-11-12, 11-12-13.
    const two = board(5, 3, 2, { 0: [0, 11] })
    const three = board(5, 3, 3, { 0: [0, 11] })
    expect(threatsAfter(two, 0, 12).size).toBe(3)
    // Two players: two threats are a fork already.
    expect(threatsAfter(two, 0, tacticalMove(two, 0, true)).size).toBeGreaterThanOrEqual(2)
    // Three players: two others move before the next turn, so it takes three.
    expect(threatsAfter(three, 0, tacticalMove(three, 0, true)).size).toBeGreaterThanOrEqual(3)
  })

  it('answers opposite corners with an edge, not a corner', () => {
    // X X in corners 0 and 8, O in the centre. A corner loses, an edge draws.
    const b = board(3, 3, 2, { 0: [0, 8], 1: [4] })
    expect([1, 3, 5, 7]).toContain(tacticalMove(b, 1, true))
  })

  it('leaves the forks to the search for the easy bot', () => {
    const b = board(9, 5, 2, { 0: [39, 40, 41], 1: [0, 80] })
    expect(tacticalMove(b, 0, false)).toBe(-1)
  })
})
