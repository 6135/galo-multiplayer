/**
 * Monte Carlo Tree Search for galo. Pure, no DOM, so it runs in a worker and in a test.
 *
 * Ported from the MCTS of 6135/IA-Mini-Project-Tict-Tac-Toe and extended from
 * 3x3 with two players to an n x n grid, a k in a row win and N players:
 *
 * - Selection by UCB1, with the same exploration constant c = 0.9.
 * - Expansion keeps only the winning children when one exists ("returnIf").
 * - Every child of the expanded node is simulated, as in the original.
 * - A heavy playout: win now, else block the next player, else a random cell.
 * - Backpropagation: 1 to the node whose mover won, 0.5 to every node on a draw.
 *   With N players each node scores from the view of the player that moved into it.
 * - A move that lets the next player win at once is pruned (score to -Infinity).
 * - The final move is the root child with the best win ratio.
 *
 * Two additions keep a big grid fast: a move is a cell next to a mark (the
 * whole grid is too wide to search), and a playout stops after a fixed depth
 * and counts as a draw.
 */

export const EMPTY = -1
const DRAW = -2
const NONE = -3
const UCB_C = 0.9

export type AiRequest = {
  size: number
  winLength: number
  /** Seat per cell, EMPTY for a free cell. */
  cells: number[]
  players: number
  toMove: number
  iterations: number
  /** Stop after this time even if iterations remain. */
  timeMs: number
}

type Board = {
  size: number
  winLength: number
  cells: Int8Array
  players: number
  filled: number
}

type Node = {
  move: number
  /** Seat that played `move`. -1 on the root. */
  mover: number
  parent: Node | null
  children: Node[] | null
  visits: number
  score: number
  /** Seat that won with `move`, DRAW on a full grid, NONE while the game runs. */
  result: number
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
    if (count >= winLength) return true
  }
  return false
}

/**
 * The cells worth a move: the free cells next to a mark. The centre on an
 * empty grid. On a 3x3 or 4x4 grid every free cell.
 */
export function candidates(board: Board): number[] {
  const { size, cells } = board
  const out: number[] = []
  if (board.filled === 0) return [Math.floor(size / 2) * size + Math.floor(size / 2)]
  for (let i = 0; i < cells.length; i += 1) {
    if (cells[i] !== EMPTY) continue
    if (size <= 4) {
      out.push(i)
      continue
    }
    const r = Math.floor(i / size)
    const c = i % size
    let near = false
    for (let dr = -1; dr <= 1 && !near; dr += 1) {
      for (let dc = -1; dc <= 1 && !near; dc += 1) {
        const rr = r + dr
        const cc = c + dc
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue
        if (cells[rr * size + cc] !== EMPTY) near = true
      }
    }
    if (near) out.push(i)
  }
  return out
}

function place(board: Board, cell: number, seat: number): void {
  board.cells[cell] = seat
  board.filled += 1
}

function nextSeat(board: Board, seat: number): number {
  return (seat + 1) % board.players
}

function resultOf(board: Board, cell: number, seat: number): number {
  if (winsAt(board.cells, board.size, board.winLength, cell, seat)) return seat
  return board.filled === board.cells.length ? DRAW : NONE
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]!
}

/**
 * Heavy playout, as in the original: win now, else block the next player,
 * else play at random. Returns the winning seat or DRAW.
 */
function playout(board: Board, toMove: number, random: () => number, maxDepth: number): number {
  let seat = toMove
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (board.filled === board.cells.length) return DRAW
    const moves = candidates(board)
    let chosen = -1
    for (const cell of moves) {
      if (winsAt(board.cells, board.size, board.winLength, cell, seat)) {
        place(board, cell, seat)
        return seat
      }
    }
    const next = nextSeat(board, seat)
    if (next !== seat) {
      for (const cell of moves) {
        if (winsAt(board.cells, board.size, board.winLength, cell, next)) {
          chosen = cell
          break
        }
      }
    }
    if (chosen === -1) chosen = pick(moves, random)
    place(board, chosen, seat)
    seat = next
  }
  return DRAW
}

function ucb(node: Node): number {
  if (node.visits === 0) return Infinity
  const parentVisits = node.parent!.visits
  return node.score / node.visits + UCB_C * Math.sqrt(Math.log(parentVisits) / node.visits)
}

function ratio(node: Node): number {
  return node.visits === 0 ? -Infinity : node.score / node.visits
}

function best(nodes: readonly Node[], value: (node: Node) => number): Node {
  let top = nodes[0]!
  let topValue = value(top)
  for (let i = 1; i < nodes.length; i += 1) {
    const v = value(nodes[i]!)
    if (v > topValue) {
      top = nodes[i]!
      topValue = v
    }
  }
  return top
}

/** Children of `node`. Only the winning ones when one exists ("returnIf"). */
function expand(node: Node, board: Board, seat: number): Node[] {
  const children: Node[] = []
  const winners: Node[] = []
  for (const cell of candidates(board)) {
    board.cells[cell] = seat
    board.filled += 1
    const child: Node = {
      move: cell,
      mover: seat,
      parent: node,
      children: null,
      visits: 0,
      score: 0,
      result: resultOf(board, cell, seat),
    }
    board.cells[cell] = EMPTY
    board.filled -= 1
    children.push(child)
    if (child.result === seat) winners.push(child)
  }
  node.children = winners.length > 0 ? winners : children
  return node.children
}

function backpropagate(from: Node, result: number): void {
  let node: Node | null = from
  while (node !== null) {
    node.visits += 1
    if (result === node.mover) node.score += 1
    else if (result === DRAW) node.score += 0.5
    node = node.parent
  }
}

function toBoard(request: AiRequest): Board {
  const cells = Int8Array.from(request.cells)
  let filled = 0
  for (const cell of cells) if (cell !== EMPTY) filled += 1
  return { size: request.size, winLength: request.winLength, cells, players: request.players, filled }
}

function copy(board: Board): Board {
  return { ...board, cells: board.cells.slice() }
}

/** Returns the cell to play. -1 when the grid is full. */
export function chooseMove(request: AiRequest, random: () => number = Math.random): number {
  const rootBoard = toBoard(request)
  if (rootBoard.filled === rootBoard.cells.length) return -1
  const root: Node = {
    move: -1,
    mover: -1,
    parent: null,
    children: null,
    visits: 0,
    score: 0,
    result: NONE,
  }
  const moves = expand(root, rootBoard, request.toMove)
  if (moves.length === 1) return moves[0]!.move

  const maxDepth = Math.max(12, request.winLength * request.players * 3)
  const deadline = Date.now() + request.timeMs

  for (let iteration = 0; iteration < request.iterations; iteration += 1) {
    if (iteration > 0 && Date.now() > deadline) break

    // Phase 1: selection. Replay the path on a copy of the root board.
    const board = copy(rootBoard)
    let node = root
    let seat = request.toMove
    while (node.children !== null && node.children.length > 0) {
      node = best(node.children, ucb)
      place(board, node.move, node.mover)
      seat = nextSeat(board, node.mover)
    }

    // Phase 2: expansion.
    const leaves = node.result === NONE ? expand(node, board, seat) : [node]

    // Phase 3 and 4: simulate every child, then backpropagate.
    for (const leaf of leaves) {
      let result = leaf.result
      if (leaf !== node) {
        // A move that lets the next player win at once leads to a loss. Prune it.
        if (result !== NONE && result !== DRAW && node.parent !== null && node.mover !== leaf.mover) {
          node.score = -Infinity
        }
        if (result === NONE) {
          const sim = copy(board)
          place(sim, leaf.move, leaf.mover)
          result = playout(sim, nextSeat(sim, leaf.mover), random, maxDepth)
        }
      }
      backpropagate(leaf, result)
    }
  }

  return best(root.children!, ratio).move
}
