/** Protocol payloads and game state. */

export type RoomStatus = 'lobby' | 'playing' | 'round_end' | 'game_over'

export type RoomConfig = {
  /** Marks in a row that win. Clamped to the grid size at round start. */
  winLength: number
  /** Optional limit: the game ends after each player opened one round. */
  onePassLimit: boolean
}

/** A bot plays on the host device. The level sets how long it thinks. */
export type BotLevel = 'easy' | 'normal' | 'hard'

export type Player = {
  id: string
  name: string
  score: number
  connected: boolean
  /** Set for a bot. A bot is always connected and never sends a message. */
  bot?: BotLevel
  /** Set when the game starts, from the frozen order. Empty in the lobby. */
  symbol: string
}

export type LastRound = {
  winnerId: string | null
  draw: boolean
  voided: boolean
}

/** Retained on `room`. Lifecycle only. Also the host Last Will. */
export type RoomMeta = {
  v: number
  seq: number
  ts: number
  src: string
  status: 'open' | 'closed'
  reason?: 'host_lost' | 'host_closed'
  hostId: string
  roomName: string
}

/** One finished round, kept for the history screen. */
export type RoundRecord = {
  n: number
  size: number
  moves: number
  starterName: string
  winnerId: string | null
  winnerName: string | null
  draw: boolean
  voided: boolean
}

/** Retained on `roster`. Published by the host. */
export type RoomState = {
  v: number
  seq: number
  ts: number
  src: string
  status: RoomStatus
  hostId: string
  hostPlayerId: string
  config: RoomConfig
  players: Player[]
  order: string[]
  roundNumber: number
  lastRound: LastRound | null
  /** Newest last. Capped, because the roster travels on every change. */
  history: RoundRecord[]
}

export type RoundOutcome = 'running' | 'won' | 'draw'

/** Retained on `round`. Published by the host. */
export type RoundState = {
  v: number
  seq: number
  ts: number
  src: string
  roundId: string
  roundNumber: number
  size: number
  winLength: number
  /** Row major, `size * size` cells. A cell holds a player identifier or null. */
  cells: (string | null)[]
  /** Cell indexes in play order. `moves.length` is the move counter. */
  moves: number[]
  turnPlayerId: string | null
  outcome: RoundOutcome
  winnerId: string | null
  /** The cells of the winning line. Empty until a win. */
  line: number[]
}

/** Published on `move` by the player on turn. Never retained. */
export type MoveRequest = {
  v: number
  seq: number
  ts: number
  src: string
  roundId: string
  playerId: string
  cell: number
  /** `moves.length` that the player saw. A stale request is refused. */
  expected: number
}

/** Published on `join`. Never retained. */
export type JoinRequest = {
  v: number
  seq: number
  ts: number
  src: string
  playerId: string
  name: string
}

/** Retained on `presence/<clientId>`. Also the client Last Will. */
export type Presence = {
  v: number
  seq: number
  ts: number
  src: string
  playerId: string
  name: string
  online: boolean
}

/**
 * Published in clear text on `galo/v1/directory/<roomId>`, retained.
 * The lobby holds no room key, so this one topic cannot be encrypted.
 * It carries no secret: the key still gates the room.
 */
export type RoomAd = {
  v: number
  roomId: string
  name: string
  players: number
  open: boolean
  ts: number
}
