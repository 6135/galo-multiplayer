/**
 * Host controller. The host owns the room state and the board. It is the only
 * writer of a score and the only judge of a move.
 */

import type { RoomLink } from '../../net/mqtt'
import { directoryTopic, type Topics } from '../../net/topics'
import { HEARTBEAT_MS } from '../../net/directory'
import { roomReducer, createRoomState, type RoomEvent } from '../../game/roomReducer'
import { applyMove, createRound, skipTurn } from '../../game/roundReducer'
import { gridSize, shuffle, starterForRound } from '../../game/order'
import { toRequest } from '../../game/ai/bot'
import { think } from '../../game/ai/think'
import type {
  BotLevel,
  JoinRequest,
  MoveRequest,
  Presence,
  RoomConfig,
  RoomState,
  RoundState,
} from '../../game/types'

/** The host waits this long for the player on turn to come back, then skips the turn. */
export const TURN_GRACE_MS = 15_000
/** A bot waits at least this long, so a person can follow its move. */
export const BOT_MIN_DELAY_MS = 450

const BOT_NAMES = ['Ana Bot', 'Rui Bot', 'Eva Bot', 'Tó Bot', 'Zé Bot', 'Lia Bot', 'Gil Bot', 'Bia Bot', 'Duda Bot', 'Nuno Bot', 'Rita Bot']

export type HostDeps = {
  link: RoomLink
  topics: Topics
  hostId: string
  hostPlayerId: string
  hostName: string
  roomName: string
  roomId: string
  /** Puts the room on the open list. The host chooses this in the lobby. */
  listed: boolean
  onState: (state: RoomState) => void
  onRound: (round: RoundState | null) => void
}

function newRoundId(): string {
  return crypto.randomUUID()
}

export class HostController {
  private state: RoomState
  private round: RoundState | null = null
  /** Client identifier to player identifier, learned from `join`. Blocks a forged move. */
  private readonly clients = new Map<string, string>()
  private graceTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  /** The board position a bot is thinking about. Stops a double move. */
  private botTurn: string | null = null
  private disposed = false

  constructor(private readonly deps: HostDeps) {
    this.state = createRoomState({
      hostId: deps.hostId,
      hostPlayerId: deps.hostPlayerId,
      hostName: deps.hostName,
    })
    this.clients.set(deps.hostId, deps.hostPlayerId)
  }

  get snapshot(): RoomState {
    return this.state
  }

  /** Publishes the retained `room` and `roster` messages. */
  async open(): Promise<void> {
    await this.deps.link.publish(
      this.deps.topics.room,
      { status: 'open', hostId: this.deps.hostId, roomName: this.deps.roomName },
      { retain: true },
    )
    await this.publishRoster()
    if (!this.deps.listed) return
    // A crashed host cannot clear the entry, and one Last Will is already
    // taken by `room`. The repeat is what makes a dead room drop off.
    this.heartbeat = setInterval(() => this.advertise(), HEARTBEAT_MS)
  }

  /** One retained message in clear text, so a lobby with no key can read it. */
  private advertise(): void {
    if (!this.deps.listed) return
    this.deps.link.publishRaw(
      directoryTopic(this.deps.roomId),
      {
        v: 1,
        roomId: this.deps.roomId,
        name: this.deps.roomName,
        players: this.state.players.filter((player) => player.connected).length,
        open: this.state.status === 'lobby',
        ts: Date.now(),
      },
      { retain: true },
    )
  }

  private async publishRoster(): Promise<void> {
    const { v: _v, seq: _seq, ts: _ts, src: _src, ...body } = this.state
    this.deps.onState(this.state)
    await this.deps.link.publish(this.deps.topics.roster, body, { retain: true })
    this.advertise()
  }

  private async publishRound(): Promise<void> {
    const round = this.round
    this.deps.onRound(round)
    if (!round) {
      this.deps.link.clearRetained(this.deps.topics.round)
      return
    }
    const { v: _v, seq: _seq, ts: _ts, src: _src, ...body } = round
    await this.deps.link.publish(this.deps.topics.round, body, { retain: true })
    this.driveBot()
  }

  /** When a bot holds the turn, the host device plays for it. */
  private driveBot(): void {
    const round = this.round
    if (!round || round.outcome !== 'running' || this.state.status !== 'playing') return
    const bot = this.state.players.find((player) => player.id === round.turnPlayerId && player.bot)
    if (!bot?.bot) return
    const key = `${round.roundId}:${round.moves.length}`
    if (this.botTurn === key) return
    this.botTurn = key
    const request = toRequest(round, this.state.order, this.state.players, bot.id, bot.bot)
    const delay = new Promise((resolve) => setTimeout(resolve, BOT_MIN_DELAY_MS))
    void Promise.all([think(request), delay]).then(async ([cell]) => {
      if (this.disposed || this.botTurn !== key) return
      this.botTurn = null
      await this.play(round.roundId, bot.id, cell, round.moves.length)
    })
  }

  /** Adds a bot in the lobby. It takes a seat like any player. */
  async addBot(level: BotLevel): Promise<void> {
    const used = new Set(this.state.players.map((player) => player.name))
    const name = BOT_NAMES.find((candidate) => !used.has(candidate)) ?? `Bot ${this.state.players.length}`
    const id = `bot-${crypto.randomUUID().slice(0, 8)}`
    await this.dispatch({ type: 'add_bot', playerId: id, name, level })
  }

  async removeBot(playerId: string): Promise<void> {
    await this.dispatch({ type: 'remove_bot', playerId })
  }

  /** Reduces one event and republishes when the state changed. */
  async dispatch(event: RoomEvent): Promise<void> {
    const next = roomReducer(this.state, event)
    if (next === this.state) return
    this.state = next
    await this.publishRoster()
  }

  async handleJoin(message: JoinRequest): Promise<void> {
    this.clients.set(message.src, message.playerId)
    await this.dispatch({ type: 'join', playerId: message.playerId, name: message.name })
  }

  async handlePresence(message: Presence): Promise<void> {
    // Presence never teaches the client map: only `join` does.
    if (this.clients.get(message.src) !== message.playerId) return
    await this.dispatch({ type: 'presence', playerId: message.playerId, online: message.online })
    if (message.playerId !== this.round?.turnPlayerId) return
    if (message.online) this.cancelGrace()
    else this.startGrace()
  }

  /** A move from the network. The publisher must be the client that joined as that player. */
  async handleMove(message: MoveRequest): Promise<void> {
    if (this.clients.get(message.src) !== message.playerId) return
    await this.play(message.roundId, message.playerId, message.cell, message.expected)
  }

  /** A move from the host screen. No network hop. */
  async localMove(cell: number): Promise<void> {
    if (!this.round) return
    await this.play(this.round.roundId, this.deps.hostPlayerId, cell, this.round.moves.length)
  }

  private async play(roundId: string, playerId: string, cell: number, expected: number): Promise<void> {
    const round = this.round
    if (this.state.status !== 'playing' || !round || round.roundId !== roundId) return
    const next = applyMove(round, { playerId, cell, expected }, this.state.order, this.state.players)
    if (next === round) return
    this.cancelGrace()
    this.round = next
    await this.publishRound()
    if (next.outcome === 'running') return
    await this.dispatch({
      type: 'round_end',
      winnerId: next.winnerId,
      draw: next.outcome === 'draw',
      size: next.size,
      moves: next.moves.length,
      starterId: this.starterOf(next),
    })
  }

  private starterOf(round: RoundState): string | null {
    const first = round.moves[0]
    if (first !== undefined) return round.cells[first] ?? null
    return round.turnPlayerId
  }

  /** Draws the board of the current round number and publishes it. */
  private async beginRound(): Promise<void> {
    this.cancelGrace()
    this.round = createRound({
      roundId: newRoundId(),
      roundNumber: this.state.roundNumber,
      size: gridSize(this.state.order.length),
      winLength: this.state.config.winLength,
      starterId: starterForRound(this.state.order, this.state.players, this.state.roundNumber),
    })
    await this.publishRound()
  }

  async setConfig(patch: Partial<RoomConfig>): Promise<void> {
    await this.dispatch({ type: 'config', patch })
  }

  /** Builds the frozen order once. The seat in the order gives the symbol. */
  async startGame(): Promise<void> {
    const ids = this.state.players.filter((player) => player.connected).map((player) => player.id)
    await this.dispatch({ type: 'start_game', order: shuffle(ids) })
    if (this.state.status === 'playing') await this.beginRound()
  }

  async nextRound(): Promise<void> {
    await this.dispatch({ type: 'start_round' })
    if (this.state.status === 'playing') {
      await this.beginRound()
    } else {
      this.round = null
      await this.publishRound()
    }
  }

  /** Puts the room back in the lobby. Nobody leaves and nobody reconnects. */
  async restart(): Promise<void> {
    this.cancelGrace()
    this.round = null
    await this.publishRound()
    await this.dispatch({ type: 'restart' })
  }

  async endGame(): Promise<void> {
    this.cancelGrace()
    this.round = null
    await this.publishRound()
    await this.dispatch({ type: 'end_game' })
  }

  /** Stops the open round. Nobody gains a point. */
  async voidRound(): Promise<void> {
    const round = this.round
    if (!round || this.state.status !== 'playing') return
    this.cancelGrace()
    await this.dispatch({
      type: 'void_round',
      size: round.size,
      moves: round.moves.length,
      starterId: this.starterOf(round),
    })
  }

  private startGrace(): void {
    if (this.graceTimer !== null) return
    if (this.state.status !== 'playing') return
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null
      void this.skip()
    }, TURN_GRACE_MS)
  }

  private async skip(): Promise<void> {
    if (!this.round || this.state.status !== 'playing') return
    const next = skipTurn(this.round, this.state.order, this.state.players)
    if (next === this.round) return
    this.round = next
    await this.publishRound()
  }

  private cancelGrace(): void {
    if (this.graceTimer === null) return
    clearTimeout(this.graceTimer)
    this.graceTimer = null
  }

  /** Closes the room by hand. The Last Will covers a lost host. */
  async close(): Promise<void> {
    this.cancelGrace()
    this.stopHeartbeat()
    this.deps.link.clearRetained(directoryTopic(this.deps.roomId))
    this.deps.link.clearRetained(this.deps.topics.round)
    await this.deps.link.publish(
      this.deps.topics.room,
      {
        status: 'closed',
        reason: 'host_closed',
        hostId: this.deps.hostId,
        roomName: this.deps.roomName,
      },
      { retain: true },
    )
  }

  private stopHeartbeat(): void {
    if (this.heartbeat === null) return
    clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  dispose(): void {
    this.disposed = true
    this.cancelGrace()
    this.stopHeartbeat()
  }
}
