/**
 * Forced moves, found without a search. In this order:
 *
 * 1. Win now.
 * 2. Block an immediate win. The next player in turn order first, because
 *    nobody else moves before them.
 * 3. Make a fork: a move that gives more winning cells than the other players
 *    can block before the next turn (one each, so `players` cells).
 * 4. Block a fork. When the opponent has two or more fork cells, one block is
 *    not enough: force the opponent with a threat of our own whose reply gives
 *    them no fork. Else block the best fork cell.
 *
 * A fork with k >= 4 covers the "open k-2" case too: that is a line which one
 * move turns into two winning cells.
 */

import { EMPTY, opponentsInOrder, place, unplace, windowsFor, type Board } from './board'
import { scoreCells } from './heuristic'

/** The free cells where `seat` wins on the next move. */
export function winCells(board: Board, seat: number): number[] {
  const { winLength: k, cells } = board
  const windows = windowsFor(board.size, k)
  const out = new Set<number>()
  for (let w = 0; w < windows.count; w += 1) {
    let own = 0
    let gap = -1
    let blocked = false
    for (let i = 0; i < k; i += 1) {
      const cell = windows.cells[w * k + i]!
      const value = cells[cell]
      if (value === seat) own += 1
      else if (value === EMPTY && gap === -1) gap = cell
      else {
        blocked = true
        break
      }
    }
    if (!blocked && own === k - 1 && gap !== -1) out.add(gap)
  }
  return [...out]
}

/** The winning cells that `seat` gets from a mark at `cell`. Reads the windows through `cell` only. */
export function threatsAfter(board: Board, seat: number, cell: number): Set<number> {
  const { winLength: k, cells } = board
  const windows = windowsFor(board.size, k)
  const out = new Set<number>()
  place(board, cell, seat)
  for (const w of windows.byCell[cell]!) {
    let own = 0
    let gap = -1
    let blocked = false
    for (let i = 0; i < k; i += 1) {
      const target = windows.cells[w * k + i]!
      const value = cells[target]
      if (value === seat) own += 1
      else if (value === EMPTY && gap === -1) gap = target
      else {
        blocked = true
        break
      }
    }
    if (!blocked && own === k - 1 && gap !== -1) out.add(gap)
  }
  unplace(board, cell)
  return out
}

function bestOf(cellsToRank: readonly number[], scores: Float64Array): number {
  let best = cellsToRank[0]!
  for (const cell of cellsToRank) if (scores[cell]! > scores[best]!) best = cell
  return best
}

/** The free cells on a live window. A cell outside every live window is never worth a move. */
function liveCells(scores: Float64Array): number[] {
  const out: number[] = []
  for (let cell = 0; cell < scores.length; cell += 1) if (scores[cell]! > 0) out.push(cell)
  return out
}

function forkCells(board: Board, seat: number, cells: readonly number[]): number[] {
  return cells.filter((cell) => threatsAfter(board, seat, cell).size >= board.players)
}

/**
 * A forced move for `seat`, or -1 when the position needs a search.
 * `full` adds the forks. Without it only the wins and the blocks count.
 */
export function tacticalMove(board: Board, seat: number, full: boolean): number {
  const scores = scoreCells(board, seat)

  const wins = winCells(board, seat)
  if (wins.length > 0) return wins[0]!

  for (const opponent of opponentsInOrder(board, seat)) {
    const threats = winCells(board, opponent)
    if (threats.length > 0) return bestOf(threats, scores)
  }

  if (!full) return -1
  const live = liveCells(scores)
  if (live.length === 0) return -1

  const forks = forkCells(board, seat, live)
  if (forks.length > 0) return bestOf(forks, scores)

  for (const opponent of opponentsInOrder(board, seat)) {
    const theirs = forkCells(board, opponent, live)
    if (theirs.length === 0) continue
    if (theirs.length === 1) return theirs[0]!
    // A threat forces the reply. The reply must not be a fork for them.
    const forcing: number[] = []
    for (const cell of live) {
      const threats = threatsAfter(board, seat, cell)
      if (threats.size !== 1) continue
      const [reply] = [...threats]
      place(board, cell, seat)
      const safe = threatsAfter(board, opponent, reply!).size < board.players
      unplace(board, cell)
      if (safe) forcing.push(cell)
    }
    return bestOf(forcing.length > 0 ? forcing : theirs, scores)
  }
  return -1
}
