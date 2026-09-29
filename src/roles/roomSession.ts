/**
 * Wires the transport to the host controller and to the store.
 * One session per tab. Every screen reads the store, never this module state.
 */

import { RoomLink, type LinkStatus } from '../net/mqtt'
import { deriveRoomId, newClientId, presenceClientId, topicsFor, type Topics } from '../net/topics'
import { deriveRoomCryptoKey } from '../net/crypto'
import { HostController } from './host/hostController'
import { useGameStore, stablePlayerId, type Identity } from '../store/gameStore'
import type {
  BotLevel,
  JoinRequest,
  MoveRequest,
  Presence,
  RoomConfig,
  RoomMeta,
  RoomState,
  RoundState,
} from '../game/types'

export type Credentials = {
  roomName: string
  roomKey: string
  playerName: string
  brokerUrl: string
  username?: string
  password?: string
  /** Puts the room on the open list. The host chooses this. */
  listRoom?: boolean
  /** Taken from the open room list, so no name has to match. */
  roomId?: string
}

export const DEFAULT_BROKER = 'wss://broker.hivemq.com:8884/mqtt'

const ROOM_WAIT_MS = 5000
const HOST_PROBE_MS = 1500

let link: RoomLink | null = null
let host: HostController | null = null
let topics: Topics | null = null
let identity: Identity | null = null

const store = useGameStore

function fail(message: string): void {
  store.getState().setError(message)
  store.getState().setPhase('error')
  void teardown()
}

async function teardown(): Promise<void> {
  host?.dispose()
  link?.close()
  host = null
  link = null
  topics = null
  identity = null
}

/** Routes one decrypted message to the right owner. */
async function route(topic: string, message: Record<string, unknown>): Promise<void> {
  if (!topics || !identity) return
  const state = store.getState()

  if (topic === topics.room) {
    const meta = message as unknown as RoomMeta
    state.setMeta(meta)
    if (meta.status === 'closed') {
      fail(meta.reason === 'host_lost' ? 'O anfitrião saiu. A sala fechou.' : 'A sala fechou.')
    }
    return
  }

  if (topic === topics.roster) {
    const roster = message as unknown as RoomState
    const meta = state.meta
    // A second host on the same topic is a room conflict.
    if (meta && roster.src !== meta.hostId) {
      fail('Conflito de sala. Outro anfitrião usa o mesmo nome e a mesma chave.')
      return
    }
    // The host writes its own store directly. Its echo adds nothing.
    if (!host) state.setRoster(roster)
    return
  }

  if (topic === topics.round) {
    const round = message as unknown as RoundState
    const meta = state.meta
    // Only the host writes the board.
    if (meta && round.src !== meta.hostId) return
    if (!host) state.setRound(round)
    return
  }

  if (topic === topics.move) {
    if (host) await host.handleMove(message as unknown as MoveRequest)
    return
  }

  if (topic === topics.join) {
    if (host) await host.handleJoin(message as unknown as JoinRequest)
    return
  }

  const client = presenceClientId(topic)
  if (client !== null) {
    const presence = message as unknown as Presence
    state.mapClient(presence.src, presence.playerId)
    if (host) await host.handlePresence(presence)
  }
}

function onStatus(status: LinkStatus, detail?: string): void {
  store.getState().setLink(status)
  if (status === 'failed' && detail) store.getState().setNotice(`Ligação: ${detail}`)
}

function onCleared(topic: string): void {
  if (topics && topic === topics.round && !host) store.getState().setRound(null)
}

async function connect(
  credentials: Credentials,
  role: 'host' | 'player',
): Promise<{ link: RoomLink; topics: Topics; identity: Identity }> {
  // A room picked from the open list carries its identifier, so a name that
  // reads differently still reaches the right topic.
  const roomId = credentials.roomId ?? (await deriveRoomId(credentials.roomName, credentials.roomKey))
  const key = await deriveRoomCryptoKey(credentials.roomKey, roomId)
  const clientId = newClientId()
  const playerId = stablePlayerId()
  const map = topicsFor(roomId)
  const who: Identity = {
    role,
    clientId,
    playerId,
    name: credentials.playerName.trim() || 'jogador',
    roomName: credentials.roomName.trim(),
    roomId,
    brokerUrl: credentials.brokerUrl,
  }

  const will =
    role === 'host'
      ? {
          topic: map.room,
          retain: true,
          payload: {
            status: 'closed',
            reason: 'host_lost',
            hostId: clientId,
            roomName: who.roomName,
          },
        }
      : {
          topic: map.presence(clientId),
          retain: true,
          payload: { playerId, name: who.name, online: false },
        }

  const connection = await RoomLink.connect({
    brokerUrl: credentials.brokerUrl,
    clientId,
    key,
    topics: map,
    ...(credentials.username ? { username: credentials.username } : {}),
    ...(credentials.password ? { password: credentials.password } : {}),
    will,
    handlers: {
      onStatus,
      onCleared,
      onUndecryptable: () => {
        /* A wrong key or a foreign message. Stay silent. */
      },
      onMessage: (topic, message) => {
        void route(topic, message)
      },
    },
  })
  return { link: connection, topics: map, identity: who }
}

function waitFor(check: () => boolean, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (check()) {
      resolve(true)
      return
    }
    const timer = setTimeout(() => {
      unsubscribe()
      resolve(false)
    }, timeout)
    const unsubscribe = store.subscribe(() => {
      if (!check()) return
      clearTimeout(timer)
      unsubscribe()
      resolve(true)
    })
  })
}

/** The host also publishes a presence message, so every row shows a state. */
async function announce(): Promise<void> {
  if (!link || !topics || !identity) return
  await link.publish(
    topics.presence(identity.clientId),
    { playerId: identity.playerId, name: identity.name, online: true },
    { retain: true },
  )
}

export async function createRoom(credentials: Credentials): Promise<void> {
  const state = store.getState()
  state.reset()
  state.setPhase('connecting')
  try {
    const session = await connect(credentials, 'host')
    link = session.link
    topics = session.topics
    identity = session.identity

    // A retained open room on the same topic means a second host. Do not steal it.
    await waitFor(() => store.getState().meta !== null, HOST_PROBE_MS)
    const meta = store.getState().meta
    if (meta && meta.status === 'open' && meta.hostId !== identity.clientId) {
      fail('Já existe uma sala com este nome e esta chave. Entre em vez de criar.')
      return
    }
    store.getState().setError(null)

    // A board left by an earlier host on this topic must not reach a joiner.
    session.link.clearRetained(session.topics.round)
    host = new HostController({
      link: session.link,
      topics: session.topics,
      hostId: session.identity.clientId,
      hostPlayerId: session.identity.playerId,
      hostName: session.identity.name,
      roomName: session.identity.roomName,
      roomId: session.identity.roomId,
      listed: credentials.listRoom !== false,
      onState: (roomState) => store.getState().setRoster(roomState),
      onRound: (round) => store.getState().setRound(round),
    })
    store.getState().setIdentity(session.identity)
    await host.open()
    await announce()
    store.getState().setPhase('in_room')
  } catch (error) {
    fail(`Não foi possível ligar ao broker: ${(error as Error).message}`)
  }
}

export async function joinRoom(credentials: Credentials): Promise<void> {
  const state = store.getState()
  state.reset()
  state.setPhase('connecting')
  try {
    const session = await connect(credentials, 'player')
    link = session.link
    topics = session.topics
    identity = session.identity

    const found = await waitFor(() => store.getState().meta !== null, ROOM_WAIT_MS)
    if (!found) {
      fail('Sala não encontrada. Verifique o nome e a chave.')
      return
    }
    const meta = store.getState().meta
    if (meta?.status !== 'open') {
      fail('A sala está fechada.')
      return
    }
    await waitFor(() => store.getState().roster !== null, ROOM_WAIT_MS)
    const roster = store.getState().roster
    const known = roster?.players.some((player) => player.id === session.identity.playerId)
    if (roster && roster.status !== 'lobby' && !known) {
      fail('O jogo já começou. A ordem está fechada.')
      return
    }

    store.getState().setIdentity(session.identity)
    // `join` goes first: the host learns this client from it, then trusts its presence.
    await session.link.publish(
      session.topics.join,
      { playerId: session.identity.playerId, name: session.identity.name },
      { retain: false },
    )
    await announce()
    store.getState().setPhase('in_room')
  } catch (error) {
    fail(`Não foi possível ligar ao broker: ${(error as Error).message}`)
  }
}

export async function leaveRoom(): Promise<void> {
  if (link && topics && identity) {
    if (host) {
      await host.close()
    } else {
      await link.publish(
        topics.presence(identity.clientId),
        { playerId: identity.playerId, name: identity.name, online: false },
        { retain: true },
      )
    }
    link.clearRetained(topics.presence(identity.clientId))
  }
  await teardown()
  store.getState().reset()
}

/** Plays one cell. The host judges it locally, a player asks the host. */
export async function playCell(cell: number): Promise<void> {
  if (host) {
    await host.localMove(cell)
    return
  }
  const round = store.getState().round
  if (!link || !topics || !identity || !round) return
  if (round.turnPlayerId !== identity.playerId || round.cells[cell] !== null) return
  await link.publish(
    topics.move,
    { roundId: round.roundId, playerId: identity.playerId, cell, expected: round.moves.length },
    { retain: false },
  )
}

export const hostApi = {
  available: () => host !== null,
  setConfig: (patch: Partial<RoomConfig>) => host?.setConfig(patch),
  addBot: (level: BotLevel) => host?.addBot(level),
  removeBot: (playerId: string) => host?.removeBot(playerId),
  startGame: () => host?.startGame(),
  nextRound: () => host?.nextRound(),
  endGame: () => host?.endGame(),
  restart: () => host?.restart(),
  voidRound: () => host?.voidRound(),
}

export function currentIdentity(): Identity | null {
  return identity
}
