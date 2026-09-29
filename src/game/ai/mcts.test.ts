import { describe, expect, it } from 'vitest'
import { chooseMove, EMPTY, winsAt, type AiRequest } from './mcts'

/** Seeded random, so a failure repeats. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** '.' is empty, a digit is a seat. Rows are joined. */
function grid(rows: string): number[] {
  return [...rows.replace(/\s+/g, '')].map((ch) => (ch === '.' ? EMPTY : Number(ch)))
}

function request(cells: number[], toMove: number, extra: Partial<AiRequest> = {}): AiRequest {
  const size = Math.round(Math.sqrt(cells.length))
  return {
    size,
    winLength: 3,
    cells,
    players: 2,
    toMove,
    iterations: 250,
    timeMs: 5000,
    ...extra,
  }
}

describe('the AI', () => {
  it('takes a win on the spot', () => {
    const cells = grid('00. 11. ...')
    expect(chooseMove(request(cells, 0), seeded(1))).toBe(2)
  })

  it('blocks the win of the other player', () => {
    const cells = grid('11. 0.. ...')
    expect(chooseMove(request(cells, 0), seeded(2))).toBe(2)
  })

  it('blocks the next player in a three player game', () => {
    // Seat 2 moves. Seat 0 threatens row 0 on a 4x4 grid. Seat 0 moves next.
    const cells = grid('00.. 1... .1.. ....')
    expect(chooseMove(request(cells, 2, { players: 3 }), seeded(3))).toBe(2)
  })

  it('says -1 on a full grid', () => {
    expect(chooseMove(request(grid('010 101 010'), 0))).toBe(-1)
  })

  it('never loses 3x3 against itself: every game is a draw', () => {
    for (let game = 0; game < 10; game += 1) {
      const random = seeded(100 + game)
      const cells = Array.from({ length: 9 }, () => EMPTY)
      let seat = game % 2
      let winner = -1
      for (let ply = 0; ply < 9 && winner === -1; ply += 1) {
        const cell = chooseMove(request(cells, seat, { iterations: 1500 }), random)
        expect(cells[cell]).toBe(EMPTY)
        cells[cell] = seat
        if (winsAt(cells, 3, 3, cell, seat)) winner = seat
        seat = 1 - seat
      }
      expect(winner).toBe(-1)
    }
  })

  it('keeps the time budget on a 13x13 grid with 12 players', () => {
    const cells = Array.from({ length: 169 }, () => EMPTY)
    cells[84] = 0
    cells[85] = 1
    const start = Date.now()
    const cell = chooseMove(
      { size: 13, winLength: 3, cells, players: 12, toMove: 2, iterations: 100000, timeMs: 300 },
      seeded(4),
    )
    expect(Date.now() - start).toBeLessThan(1500)
    expect(cells[cell]).toBe(EMPTY)
  })
})
