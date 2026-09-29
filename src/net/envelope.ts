/** Envelope fields, the replay guard and the clock guard. */

import { PROTOCOL_VERSION } from './topics'

export const MAX_CLOCK_SKEW_MS = 120_000

export type Envelope = {
  v: number
  seq: number
  ts: number
  src: string
}

export type Rejection =
  | 'not_an_object'
  | 'bad_version'
  | 'bad_seq'
  | 'replayed'
  | 'clock_skew'
  | 'bad_src'

export function isEnvelope(value: unknown): value is Envelope & Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record['v'] === 'number' &&
    typeof record['seq'] === 'number' &&
    typeof record['ts'] === 'number' &&
    typeof record['src'] === 'string'
  )
}

export function isLastWill(message: Record<string, unknown>): boolean {
  return message['lwt'] === true
}

/**
 * Tracks the last accepted sequence number per topic and per publisher.
 * QoS 1 delivers at least once, so every handler must be idempotent.
 *
 * The key holds the publisher because several clients write the same topic:
 * every player publishes `join` and `move`.
 */
export class ReplayGuard {
  private readonly lastSeq = new Map<string, number>()

  private static key(topic: string, src: string): string {
    return `${topic}\u0000${src}`
  }

  /**
   * Accepts a message once. A repeated or an older `seq` is rejected.
   *
   * A Last Will payload is the exception. The broker holds it from connect
   * time and publishes it much later, so its `ts` and its `seq` are both
   * stale by design. Such a message skips both checks and does not move the
   * stored sequence number. Every Last Will handler is idempotent.
   */
  accept(topic: string, message: unknown, now = Date.now()): Rejection | null {
    if (!isEnvelope(message)) return 'not_an_object'
    if (message.v !== PROTOCOL_VERSION) return 'bad_version'
    if (message.src.length === 0) return 'bad_src'
    if (isLastWill(message)) return null
    if (!Number.isFinite(message.seq) || message.seq < 0) return 'bad_seq'
    if (Math.abs(now - message.ts) > MAX_CLOCK_SKEW_MS) return 'clock_skew'
    const key = ReplayGuard.key(topic, message.src)
    const last = this.lastSeq.get(key)
    if (last !== undefined && message.seq <= last) return 'replayed'
    this.lastSeq.set(key, message.seq)
    return null
  }

  /** A cleared retained topic must not block the next round. */
  reset(topic: string): void {
    const prefix = `${topic}\u0000`
    for (const key of this.lastSeq.keys()) {
      if (key.startsWith(prefix)) this.lastSeq.delete(key)
    }
  }
}

/** Monotonic counter for the topics that this client publishes. */
export class SeqSource {
  private value = 0
  next(): number {
    this.value += 1
    return this.value
  }
}

export function stamp(src: string, seq: number): Envelope {
  return { v: PROTOCOL_VERSION, seq, ts: Date.now(), src }
}
