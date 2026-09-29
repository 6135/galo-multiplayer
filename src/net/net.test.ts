import { describe, expect, it } from 'vitest'
import { base32, deriveRoomId, normalizeRoomName, presenceClientId, topicsFor } from './topics'
import { deriveRoomCryptoKey, open, seal } from './crypto'
import { ReplayGuard } from './envelope'

describe('the room identifier', () => {
  it('normalizes the name before the hash', () => {
    expect(normalizeRoomName('  Sala   DOS Amigos ')).toBe('sala dos amigos')
  })

  it('gives the same identifier for the same name and key', async () => {
    const a = await deriveRoomId('Sala  dos Amigos', 'chave')
    const b = await deriveRoomId('sala dos amigos', 'chave')
    expect(a).toBe(b)
    expect(a).toHaveLength(16)
  })

  it('changes with the key, so the name alone does not open the topic', async () => {
    const a = await deriveRoomId('sala', 'chave')
    const b = await deriveRoomId('sala', 'outra')
    expect(a).not.toBe(b)
  })

  it('encodes base32 without padding', () => {
    expect(base32(new Uint8Array([0, 0, 0, 0, 0]))).toBe('AAAAAAAA')
  })

  it('reads the client identifier out of a presence topic', () => {
    const topics = topicsFor('ROOM')
    expect(presenceClientId(topics.presence('galo-1234'))).toBe('galo-1234')
    expect(presenceClientId(topics.roster)).toBe(null)
  })
})

describe('the envelope', () => {
  it('reads back what it sealed', async () => {
    const key = await deriveRoomCryptoKey('chave', 'ROOM')
    const topic = 'galo/v1/ROOM/roster'
    const payload = await seal(key, topic, { v: 1, seq: 1, ts: 0, src: 'x', hello: 'olá' })
    expect(await open(key, topic, payload)).toMatchObject({ hello: 'olá' })
  })

  it('refuses a payload moved to another topic', async () => {
    const key = await deriveRoomCryptoKey('chave', 'ROOM')
    const payload = await seal(key, 'galo/v1/ROOM/roster', { v: 1 })
    expect(await open(key, 'galo/v1/ROOM/round', payload)).toBe(null)
  })

  it('refuses a wrong key without a throw', async () => {
    const key = await deriveRoomCryptoKey('chave', 'ROOM')
    const other = await deriveRoomCryptoKey('errada', 'ROOM')
    const payload = await seal(key, 'galo/v1/ROOM/roster', { v: 1 })
    expect(await open(other, 'galo/v1/ROOM/roster', payload)).toBe(null)
  })
})

describe('the replay guard', () => {
  const topic = 'galo/v1/ROOM/roster'
  const message = (seq: number, extra: object = {}) => ({
    v: 1,
    seq,
    ts: Date.now(),
    src: 'c',
    ...extra,
  })

  it('accepts a rising sequence only', () => {
    const guard = new ReplayGuard()
    expect(guard.accept(topic, message(1))).toBe(null)
    expect(guard.accept(topic, message(2))).toBe(null)
    expect(guard.accept(topic, message(2))).toBe('replayed')
    expect(guard.accept(topic, message(1))).toBe('replayed')
  })

  it('refuses a wrong version and a bad clock', () => {
    const guard = new ReplayGuard()
    expect(guard.accept(topic, { ...message(1), v: 2 })).toBe('bad_version')
    expect(guard.accept(topic, { v: 1, seq: 1, ts: 0, src: 'c' })).toBe('clock_skew')
    expect(guard.accept(topic, { hello: 'x' })).toBe('not_an_object')
  })

  it('lets a Last Will through and does not move the sequence', () => {
    const guard = new ReplayGuard()
    expect(guard.accept(topic, message(5))).toBe(null)
    expect(guard.accept(topic, { v: 1, seq: 0, ts: 0, src: 'c', lwt: true })).toBe(null)
    expect(guard.accept(topic, message(6))).toBe(null)
  })

  it('counts each publisher on its own, so a second joiner is not a replay', () => {
    const guard = new ReplayGuard()
    const join = 'galo/v1/ROOM/join'
    expect(guard.accept(join, message(1, { src: 'client-a' }))).toBe(null)
    expect(guard.accept(join, message(1, { src: 'client-b' }))).toBe(null)
    expect(guard.accept(join, message(1, { src: 'client-a' }))).toBe('replayed')
  })

  it('forgets the sequence when a retained topic is cleared', () => {
    const guard = new ReplayGuard()
    expect(guard.accept(topic, message(9))).toBe(null)
    guard.reset(topic)
    expect(guard.accept(topic, message(1))).toBe(null)
  })
})
