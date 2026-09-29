/**
 * Static evaluation, window based, as in Gomoku programs.
 *
 * A window is a run of k cells. A window that holds marks of one seat only is
 * "live" for that seat: the seat can still win inside it. A window with marks
 * of two seats is dead for everybody. The value of a live window grows fast
 * with the marks in it, so one k-1 window is worth more than many short ones.
 *
 * This handles gaps (X_XX), dead lines and any number of players, and a cell
 * on two good windows (a fork) scores the sum of both.
 */

import { EMPTY, windowsFor, type Board } from './board'

/** Value of a live window that holds `n` marks of one seat, for a win length `k`. */
export function windowValue(n: number, k: number): number {
  if (n >= k) return 1e7
  if (n === 0) return 0
  if (n === k - 1) return 10 ** (n + 1) * 10
  return 10 ** n
}

/** Defence counts a little less than attack, so a bot takes its own chance first. */
const DEFENCE = 0.9
/** A threat from a player further away in the turn order is a little less urgent. */
const DISTANCE_DECAY = 0.85

/**
 * The value of each free cell for the player `seat` who moves now:
 * what the cell adds to the own live windows (attack), plus what it takes
 * away from the live windows of the other seats (defence).
 * A taken cell scores -1.
 */
export function scoreCells(board: Board, seat: number): Float64Array {
  const { size, winLength: k, cells } = board
  const windows = windowsFor(size, k)
  const scores = new Float64Array(size * size)
  const weight = new Float64Array(board.players)
  let weightAll = 0
  for (let step = 1; step < board.players; step += 1) {
    const w = DEFENCE * DISTANCE_DECAY ** (step - 1)
    weight[(seat + step) % board.players] = w
    weightAll += w
  }

  for (let w = 0; w < windows.count; w += 1) {
    const base = w * k
    let owner = EMPTY
    let n = 0
    let dead = false
    for (let i = 0; i < k; i += 1) {
      const value = cells[windows.cells[base + i]!]!
      if (value === EMPTY) continue
      if (owner === EMPTY) owner = value
      else if (owner !== value) {
        dead = true
        break
      }
      n += 1
    }
    // A mark of a player who left blocks the window like a mark of another seat.
    if (dead || (owner !== EMPTY && owner >= board.players)) continue
    const gain = windowValue(n + 1, k) - windowValue(n, k)
    let value: number
    if (owner === EMPTY) value = gain * (1 + weightAll)
    else if (owner === seat) value = gain
    else value = gain * weight[owner]!
    for (let i = 0; i < k; i += 1) {
      const cell = windows.cells[base + i]!
      if (cells[cell] === EMPTY) scores[cell]! += value
    }
  }
  for (let cell = 0; cell < cells.length; cell += 1) {
    if (cells[cell] !== EMPTY) scores[cell] = -1
  }
  return scores
}

/**
 * The strength of each seat on this board: the sum of its live windows.
 * Used where a playout stops before the end of the game.
 */
export function seatPotentials(board: Board): Float64Array {
  const { size, winLength: k, cells } = board
  const windows = windowsFor(size, k)
  const potential = new Float64Array(board.players)
  for (let w = 0; w < windows.count; w += 1) {
    const base = w * k
    let owner = EMPTY
    let n = 0
    let dead = false
    for (let i = 0; i < k; i += 1) {
      const value = cells[windows.cells[base + i]!]!
      if (value === EMPTY) continue
      if (owner === EMPTY) owner = value
      else if (owner !== value) {
        dead = true
        break
      }
      n += 1
    }
    if (dead || owner === EMPTY || owner >= board.players) continue
    potential[owner]! += windowValue(n, k)
  }
  return potential
}

/**
 * A result in [0, 1] per seat for a board where the game has not ended.
 * Equal strength gives 0.5, the same as a draw. A clear lead goes towards 1.
 */
export function cutoffValues(board: Board): Float64Array {
  const potential = seatPotentials(board)
  const values = new Float64Array(board.players)
  for (let seat = 0; seat < board.players; seat += 1) {
    let rival = 0
    for (let other = 0; other < board.players; other += 1) {
      if (other !== seat && potential[other]! > rival) rival = potential[other]!
    }
    const own = potential[seat]!
    values[seat] = own + rival === 0 ? 0.5 : 0.5 + (0.5 * (own - rival)) / (own + rival)
  }
  return values
}
