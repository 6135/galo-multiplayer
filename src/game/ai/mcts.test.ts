import { describe, expect, it } from 'vitest'
import { chooseMove, EMPTY, search, winsAt, type AiRequest, type SearchMemory } from './mcts'

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

  it('blocks an open three with five in a row on 9x9', () => {
    const cells = Array.from({ length: 81 }, () => EMPTY)
    for (const cell of [39, 40, 41]) cells[cell] = 0
    cells[30] = 1
    cells[50] = 1
    const cell = chooseMove(
      { size: 9, winLength: 5, cells, players: 2, toMove: 1, iterations: 250, timeMs: 2000 },
      seeded(5),
    )
    expect([38, 42]).toContain(cell)
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

describe('the search on a big grid', () => {
  const empty81 = () => Array.from({ length: 81 }, () => EMPTY)
  const base = (cells: number[], toMove: number): AiRequest => ({
    size: 9,
    winLength: 5,
    cells,
    players: 2,
    toMove,
    iterations: 600,
    timeMs: 5000,
    memoryKey: 'bot',
  })

  it('looks more than two plies ahead', () => {
    const cells = empty81()
    cells[40] = 0
    cells[41] = 1
    const result = search(base(cells, 0), seeded(7))
    expect(result.forced).toBe(false)
    expect(result.depth).toBeGreaterThanOrEqual(4)
  })

  it('keeps the tree for the next turn of the same bot', () => {
    const memory: SearchMemory = new Map()
    const cells = empty81()
    cells[40] = 0
    cells[41] = 1
    const first = search(base(cells, 0), seeded(8), memory)
    expect(first.reused).toBe(0)

    // The other player answers with the reply the tree knows best.
    const mine = memory.get('bot')!.root.children!.find((node) => node.move === first.cell)!
    const reply = mine.children!.reduce((a, b) => (b.visits > a.visits ? b : a))
    const known = reply.visits
    const next = cells.slice()
    next[first.cell] = 0
    next[reply.move] = 1
    const second = search(base(next, 0), seeded(9), memory)
    expect(second.reused).toBe(known)
    expect(second.reused).toBeGreaterThan(0)
  })

  it('starts a new tree when the position does not follow', () => {
    const memory: SearchMemory = new Map()
    const cells = empty81()
    cells[40] = 0
    cells[41] = 1
    search(base(cells, 0), seeded(10), memory)
    const other = empty81()
    other[10] = 0
    other[11] = 1
    expect(search(base(other, 0), seeded(11), memory).reused).toBe(0)
  })
})
