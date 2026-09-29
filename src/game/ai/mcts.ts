/**
 * Monte Carlo Tree Search for galo. Pure, no DOM, so it runs in a worker and in a test.
 *
 * Ported from the MCTS of 6135/IA-Mini-Project-Tict-Tac-Toe and extended from
 * 3x3 with two players to an n x n grid, a k in a row win and N players.
 * Kept from the original:
 *
 * - Selection by UCB1, with the same exploration constant c = 0.9.
 * - Expansion keeps only the winning children when one exists ("returnIf").
 * - The children of the expanded node are simulated at once.
 * - Backpropagation: 1 to the node whose mover won, 0.5 to every node on a draw.
 *   With N players each node scores from the view of the player that moved into it.
 * - A move that lets the next player win at once is pruned (score to -Infinity).
 * - The final move is the root child with the best win ratio.
 *
 * Added for a big grid:
 *
 * - A tactics layer runs first: win, block, fork, block a fork (`tactics.ts`).
 * - The heuristic (`heuristic.ts`) ranks the moves. A node opens its best
 *   moves first and more of them as it gets visits (progressive widening),
 *   and a good move gets a bonus that fades with visits (progressive bias).
 * - A playout picks cells by the heuristic, not at random.
 * - A playout that reaches the depth cap is scored by the heuristic, not as a draw.
 */

import {
  copyBoard,
  EMPTY,
  nextSeat,
  place,
  unplace,
  winsAt,
  type Board,
} from './board'
import { cutoffValues, scoreCells } from './heuristic'
import { tacticalMove } from './tactics'

export { EMPTY, winsAt } from './board'

const DRAW = -2
const NONE = -3
const UCB_C = 0.9
/** Weight of the heuristic bonus in the selection. */
const BIAS = 0.5
/** A node opens this many moves at first, then more as its visits grow. */
const WIDEN_MIN = 5
const WIDEN_RATE = 1.5
/** In a playout, the best cell is taken this often. Else one of the next best. */
const GREEDY = 0.6
const PLAYOUT_TOP = 4

export type AiRequest = {
  size: number
  winLength: number
  /** Seat per cell, EMPTY for a free cell. A seat of `players` or more only blocks. */
  cells: number[]
  players: number
  toMove: number
  iterations: number
  /** Stop after this time even if iterations remain. */
  timeMs: number
  /** Look for forks before the search. Off for the easy bot. */
  forks?: boolean
}

type Node = {
  move: number
  /** Seat that played `move`. -1 on the root. */
  mover: number
  parent: Node | null
  /** Best move first. Only the first `opened(node)` take part in the selection. */
  children: Node[] | null
  visits: number
  score: number
  /** Heuristic rank of the move, 0 to 1. */
  prior: number
  /** Seat that won with `move`, DRAW on a full grid, NONE while the game runs. */
  result: number
}

function resultOf(board: Board, cell: number, seat: number): number {
  if (winsAt(board.cells, board.size, board.winLength, cell, seat)) return seat
  return board.filled === board.cells.length ? DRAW : NONE
}

/** 1 to the winner, 0.5 to everybody on a draw. As in the original. */
function valuesOf(result: number, players: number): Float64Array {
  const values = new Float64Array(players)
  if (result === DRAW) values.fill(0.5)
  else if (result >= 0 && result < players) values[result] = 1
  return values
}

function opened(node: Node): number {
  const count = node.children?.length ?? 0
  return Math.min(count, WIDEN_MIN + Math.floor(WIDEN_RATE * Math.sqrt(node.visits)))
}

function selectionValue(node: Node): number {
  if (node.visits === 0) return Infinity
  const parentVisits = node.parent!.visits
  return (
    node.score / node.visits +
    UCB_C * Math.sqrt(Math.log(parentVisits) / node.visits) +
    (BIAS * node.prior) / (node.visits + 1)
  )
}

function ratio(node: Node): number {
  return node.visits === 0 ? -Infinity : node.score / node.visits
}

function best(nodes: readonly Node[], count: number, value: (node: Node) => number): Node {
  let top = nodes[0]!
  let topValue = value(top)
  for (let i = 1; i < count; i += 1) {
    const v = value(nodes[i]!)
    if (v > topValue) {
      top = nodes[i]!
      topValue = v
    }
  }
  return top
}

/** The moves worth a look, best first: the free cells on a live window. */
function rankedMoves(board: Board, seat: number): { cell: number; score: number }[] {
  const scores = scoreCells(board, seat)
  const moves: { cell: number; score: number }[] = []
  for (let cell = 0; cell < scores.length; cell += 1) {
    if (scores[cell]! > 0) moves.push({ cell, score: scores[cell]! })
  }
  // No live window is left, so the game is a draw. Any free cell will do.
  if (moves.length === 0) {
    for (let cell = 0; cell < board.cells.length; cell += 1) {
      if (board.cells[cell] === EMPTY) moves.push({ cell, score: 0 })
    }
  }
  return moves.sort((a, b) => b.score - a.score)
}

/** Children of `node`, best first. Only the winning ones when one exists ("returnIf"). */
function expand(node: Node, board: Board, seat: number): Node[] {
  const moves = rankedMoves(board, seat)
  const top = Math.log1p(moves[0]?.score ?? 0) || 1
  const children: Node[] = []
  const winners: Node[] = []
  for (const { cell, score } of moves) {
    place(board, cell, seat)
    const child: Node = {
      move: cell,
      mover: seat,
      parent: node,
      children: null,
      visits: 0,
      score: 0,
      prior: Math.log1p(score) / top,
      result: resultOf(board, cell, seat),
    }
    unplace(board, cell)
    children.push(child)
    if (child.result === seat) winners.push(child)
  }
  node.children = winners.length > 0 ? winners : children
  return node.children
}

/** Picks a playout cell: the best one most of the time, else one of the next best. */
function playoutCell(scores: Float64Array, cells: Int8Array, random: () => number): number {
  const top: number[] = []
  for (let cell = 0; cell < scores.length; cell += 1) {
    if (cells[cell] !== EMPTY) continue
    let at = top.length
    while (at > 0 && scores[cell]! > scores[top[at - 1]!]!) at -= 1
    if (at < PLAYOUT_TOP) {
      top.splice(at, 0, cell)
      if (top.length > PLAYOUT_TOP) top.pop()
    }
  }
  if (top.length === 0) return -1
  if (random() < GREEDY) return top[0]!
  return top[Math.floor(random() * top.length)]!
}

/**
 * Plays on with the heuristic until a result or the depth cap. The heuristic
 * makes a win and a block the best cells, so the original "win, else block,
 * else random" rule is kept. Returns a value in [0, 1] per seat.
 */
function playout(board: Board, toMove: number, random: () => number, maxDepth: number): Float64Array {
  let seat = toMove
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (board.filled === board.cells.length) return valuesOf(DRAW, board.players)
    const cell = playoutCell(scoreCells(board, seat), board.cells, random)
    if (cell === -1) return valuesOf(DRAW, board.players)
    place(board, cell, seat)
    if (winsAt(board.cells, board.size, board.winLength, cell, seat)) {
      return valuesOf(seat, board.players)
    }
    seat = nextSeat(board, seat)
  }
  return cutoffValues(board)
}

function backpropagate(from: Node, values: Float64Array): void {
  let node: Node | null = from
  while (node !== null) {
    node.visits += 1
    if (node.mover >= 0) node.score += values[node.mover]!
    node = node.parent
  }
}

function toBoard(request: AiRequest): Board {
  const cells = Int8Array.from(request.cells)
  let filled = 0
  for (const cell of cells) if (cell !== EMPTY) filled += 1
  return { size: request.size, winLength: request.winLength, cells, players: request.players, filled }
}

/** Returns the cell to play. -1 when the grid is full. */
export function chooseMove(request: AiRequest, random: () => number = Math.random): number {
  const rootBoard = toBoard(request)
  if (rootBoard.filled === rootBoard.cells.length) return -1

  const forced = tacticalMove(rootBoard, request.toMove, request.forks !== false)
  if (forced !== -1) return forced

  const root: Node = {
    move: -1,
    mover: -1,
    parent: null,
    children: null,
    visits: 0,
    score: 0,
    prior: 0,
    result: NONE,
  }
  const moves = expand(root, rootBoard, request.toMove)
  if (moves.length === 1) return moves[0]!.move

  const maxDepth = Math.max(8, 2 * request.players + 2 * request.winLength)
  const deadline = Date.now() + request.timeMs

  for (let iteration = 0; iteration < request.iterations; iteration += 1) {
    if (iteration > 0 && Date.now() > deadline) break

    // Phase 1: selection. Replay the path on a copy of the root board.
    const board = copyBoard(rootBoard)
    let node = root
    let seat = request.toMove
    while (node.children !== null && node.children.length > 0) {
      node = best(node.children, opened(node), selectionValue)
      place(board, node.move, node.mover)
      seat = nextSeat(board, node.mover)
    }

    // Phase 2: expansion. Phase 3: simulate the opened children.
    const leaves =
      node.result === NONE ? expand(node, board, seat).slice(0, WIDEN_MIN) : [node]

    for (const leaf of leaves) {
      let values: Float64Array
      if (leaf === node) {
        values = valuesOf(leaf.result, board.players)
      } else if (leaf.result !== NONE) {
        // A move that lets the next player win at once leads to a loss. Prune it.
        if (leaf.result >= 0 && node.parent !== null && node.mover !== leaf.mover) {
          node.score = -Infinity
        }
        values = valuesOf(leaf.result, board.players)
      } else {
        const sim = copyBoard(board)
        place(sim, leaf.move, leaf.mover)
        values = playout(sim, nextSeat(sim, leaf.mover), random, maxDepth)
      }
      // Phase 4: backpropagation.
      backpropagate(leaf, values)
    }
  }

  return best(root.children!, root.children!.length, ratio).move
}
