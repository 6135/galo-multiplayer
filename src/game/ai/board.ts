/** The board the AI searches on. Seats are small integers, EMPTY is a free cell. */

export const EMPTY = -1

export type Board = {
  size: number
  winLength: number
  /** Seat per cell. A seat of `players` or more belongs to a player who left: it blocks, it never moves. */
  cells: Int8Array
  players: number
  filled: number
}

/**
 * Every run of `winLength` cells in a row, column or diagonal. A line can only
 * be won inside one of these windows, so the heuristic and the tactics read them.
 */
export type Windows = {
  k: number
  /** Window w holds the cells `cells[w * k .. w * k + k - 1]`. */
  cells: Int16Array
  count: number
  /** The windows that pass through each cell. */
  byCell: Int32Array[]
}

const cache = new Map<string, Windows>()

export function windowsFor(size: number, k: number): Windows {
  const key = `${size}:${k}`
  const hit = cache.get(key)
  if (hit) return hit
  const list: number[] = []
  const byCell: number[][] = Array.from({ length: size * size }, () => [])
  const directions: readonly (readonly [number, number])[] = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ]
  let count = 0
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      for (const [dr, dc] of directions) {
        const endR = r + dr * (k - 1)
        const endC = c + dc * (k - 1)
        if (endR < 0 || endR >= size || endC < 0 || endC >= size) continue
        for (let i = 0; i < k; i += 1) {
          const cell = (r + dr * i) * size + (c + dc * i)
          list.push(cell)
          byCell[cell]!.push(count)
        }
        count += 1
      }
    }
  }
  const windows: Windows = {
    k,
    cells: Int16Array.from(list),
    count,
    byCell: byCell.map((ids) => Int32Array.from(ids)),
  }
  cache.set(key, windows)
  return windows
}

const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
]

/** True when `seat` at `cell` makes `winLength` in a row. The cell may still be empty. */
export function winsAt(
  cells: ArrayLike<number>,
  size: number,
  winLength: number,
  cell: number,
  seat: number,
): boolean {
  const row = Math.floor(cell / size)
  const col = cell % size
  for (const [dr, dc] of DIRECTIONS) {
    let count = 1
    for (const sign of [1, -1]) {
      let r = row + dr * sign
      let c = col + dc * sign
      while (r >= 0 && r < size && c >= 0 && c < size && cells[r * size + c] === seat) {
        count += 1
        if (count >= winLength) return true
        r += dr * sign
        c += dc * sign
      }
    }
  }
  return false
}

export function place(board: Board, cell: number, seat: number): void {
  board.cells[cell] = seat
  board.filled += 1
}

export function unplace(board: Board, cell: number): void {
  board.cells[cell] = EMPTY
  board.filled -= 1
}

export function copyBoard(board: Board): Board {
  return { ...board, cells: board.cells.slice() }
}

export function nextSeat(board: Board, seat: number): number {
  return (seat + 1) % board.players
}

/** The seats in turn order after `seat`: the next player first. */
export function opponentsInOrder(board: Board, seat: number): number[] {
  const out: number[] = []
  for (let step = 1; step < board.players; step += 1) out.push((seat + step) % board.players)
  return out
}
