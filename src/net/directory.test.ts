import { describe, expect, it } from 'vitest'
import { isFresh, parseAd, STALE_MS } from './directory'
import type { RoomAd } from '../game/types'

const TOPIC = 'galo/v1/directory/GDJV34RLEPPCFJMB'

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value))
}

const good = {
  v: 1,
  roomId: 'GDJV34RLEPPCFJMB',
  name: 'sala',
  players: 3,
  open: true,
  ts: Date.now(),
}

describe('the open room list', () => {
  it('reads a well formed entry', () => {
    expect(parseAd(TOPIC, bytes(good))).toMatchObject({
      roomId: 'GDJV34RLEPPCFJMB',
      name: 'sala',
      players: 3,
      open: true,
    })
  })

  it('takes the identifier from the topic, not from the payload', () => {
    expect(parseAd(TOPIC, bytes({ ...good, roomId: 'OTHER' }))?.roomId).toBe('GDJV34RLEPPCFJMB')
  })

  it('refuses a topic that is not a room identifier', () => {
    expect(parseAd('galo/v1/directory/nope', bytes(good))).toBe(null)
    expect(parseAd('galo/v1/directory/GDJV34RLEPPCFJM', bytes(good))).toBe(null)
  })

  it('refuses rubbish from the public broker', () => {
    expect(parseAd(TOPIC, bytes('not json'))).toBe(null)
    expect(parseAd(TOPIC, bytes([1, 2, 3]))).toBe(null)
    expect(parseAd(TOPIC, bytes({ ...good, v: 2 }))).toBe(null)
    expect(parseAd(TOPIC, bytes({ ...good, name: 42 }))).toBe(null)
    expect(parseAd(TOPIC, bytes({ ...good, ts: 'agora' }))).toBe(null)
    expect(parseAd(TOPIC, new Uint8Array(0))).toBe(null)
    expect(parseAd(TOPIC, new Uint8Array(3000))).toBe(null)
  })

  it('cuts a name that would break the row, and drops the control characters', () => {
    const noisy = 'a' + String.fromCharCode(10) + 'b' + 'x'.repeat(80)
    const ad = parseAd(TOPIC, bytes({ ...good, name: noisy }))
    expect(ad?.name).toHaveLength(40)
    expect(ad?.name.startsWith('a b')).toBe(true)
    expect(parseAd(TOPIC, bytes({ ...good, name: '   ' }))).toBe(null)
  })

  it('clamps the player count', () => {
    expect(parseAd(TOPIC, bytes({ ...good, players: -5 }))?.players).toBe(0)
    expect(parseAd(TOPIC, bytes({ ...good, players: 1e6 }))?.players).toBe(99)
    expect(parseAd(TOPIC, bytes({ ...good, players: 'muitos' }))?.players).toBe(0)
  })

  it('treats a stale entry as gone, because a dead host cannot clear it', () => {
    const now = Date.now()
    const old: RoomAd = { ...good, ts: now - STALE_MS - 1 }
    expect(isFresh(old, now)).toBe(false)
    expect(isFresh({ ...good, ts: now - 1000 }, now)).toBe(true)
  })
})
