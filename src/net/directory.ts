/**
 * The open room list.
 *
 * A person at the lobby holds no room key, so this list cannot be encrypted.
 * It therefore publishes the room name and nothing else that matters: the key
 * still gates the room, and it still derives the key that reads the traffic.
 * A host lists a room only when the host asks for it.
 */

import mqtt from 'mqtt'
import type { RoomAd } from '../game/types'
import { DIRECTORY_FILTER, newClientId, PROTOCOL_VERSION } from './topics'

/** The host repeats the message, so a dead room drops off the list. */
export const HEARTBEAT_MS = 30_000
export const STALE_MS = 90_000
const MAX_NAME = 40
const CONTROL = /[\u0000-\u001F\u007F]/g

export function isFresh(ad: RoomAd, now = Date.now()): boolean {
  return now - ad.ts < STALE_MS
}

/**
 * Reads one list entry. The payload comes from a public broker, so every
 * field is checked and the name is trimmed to a size the screen can hold.
 */
export function parseAd(topic: string, payload: Uint8Array): RoomAd | null {
  const roomId = topic.split('/').pop()
  if (!roomId || !/^[A-Z2-7]{16}$/.test(roomId)) return null
  if (payload.length === 0 || payload.length > 2000) return null

  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(payload))
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null

  const record = value as Record<string, unknown>
  if (record['v'] !== PROTOCOL_VERSION) return null
  if (typeof record['name'] !== 'string') return null
  if (typeof record['ts'] !== 'number' || !Number.isFinite(record['ts'])) return null

  const players = typeof record['players'] === 'number' ? record['players'] : 0
  const name = record['name'].replace(CONTROL, ' ').trim().slice(0, MAX_NAME)
  if (name.length === 0) return null

  return {
    v: PROTOCOL_VERSION,
    roomId,
    name,
    players: Math.max(0, Math.min(99, Math.round(players))),
    open: record['open'] === true,
    ts: record['ts'],
  }
}

/**
 * Watches the list until the returned function is called.
 * The callback runs on every change and on every prune.
 */
export function watchDirectory(
  brokerUrl: string,
  onChange: (rooms: RoomAd[]) => void,
): () => void {
  const rooms = new Map<string, RoomAd>()
  let closed = false

  const client = mqtt.connect(brokerUrl, {
    clientId: newClientId().replace('galo-', 'lobby-'),
    clean: true,
    keepalive: 30,
    reconnectPeriod: 4000,
    connectTimeout: 8000,
  })

  const emit = () => {
    const now = Date.now()
    for (const [roomId, ad] of rooms) if (!isFresh(ad, now)) rooms.delete(roomId)
    onChange([...rooms.values()].sort((a, b) => b.ts - a.ts))
  }

  client.on('connect', () => client.subscribe(DIRECTORY_FILTER, { qos: 1 }))
  client.on('error', () => {
    /* The list is a convenience. A broker that refuses it is not an error. */
  })
  client.on('message', (topic, payload) => {
    if (closed) return
    const bytes = new Uint8Array(payload)
    if (bytes.length === 0) {
      // A cleared retained message means the room is gone.
      rooms.delete(topic.split('/').pop() ?? '')
      emit()
      return
    }
    const ad = parseAd(topic, bytes)
    if (!ad || !isFresh(ad)) return
    rooms.set(ad.roomId, ad)
    emit()
  })

  const prune = setInterval(emit, 15_000)

  return () => {
    closed = true
    clearInterval(prune)
    client.end(true)
  }
}
