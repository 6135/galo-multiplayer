/** MQTT transport: connect, Last Will, subscribe, sealed publish. */

import { Buffer } from 'buffer'
import mqtt from 'mqtt'
import type { IClientOptions, MqttClient } from 'mqtt'
import { open, seal } from './crypto'
import { ReplayGuard, SeqSource, type Rejection } from './envelope'
import { PROTOCOL_VERSION, type Topics } from './topics'

export type LinkStatus = 'connecting' | 'online' | 'reconnecting' | 'offline' | 'failed'

/** The envelope fields are stamped at publish time, never by the caller. */
export type Body<T> = Omit<T, 'v' | 'seq' | 'ts' | 'src'>

export type LinkHandlers = {
  onStatus: (status: LinkStatus, detail?: string) => void
  onMessage: (topic: string, message: Record<string, unknown>) => void
  onCleared: (topic: string) => void
  onUndecryptable: (topic: string) => void
  onRejected?: (topic: string, reason: Rejection) => void
}

export type LinkOptions = {
  brokerUrl: string
  clientId: string
  key: CryptoKey
  topics: Topics
  username?: string
  password?: string
  /** Sealed at connect time. The room key is known at that moment. */
  will?: { topic: string; payload: unknown; retain: boolean }
  handlers: LinkHandlers
}

const CONNECT_TIMEOUT_MS = 8000

export class RoomLink {
  private client: MqttClient | null = null
  private readonly guard = new ReplayGuard()
  private readonly seqs = new Map<string, SeqSource>()
  private closed = false

  private constructor(private readonly options: LinkOptions) {}

  static async connect(options: LinkOptions): Promise<RoomLink> {
    const link = new RoomLink(options)
    await link.start()
    return link
  }

  get clientId(): string {
    return this.options.clientId
  }

  private async start(): Promise<void> {
    const will = this.options.will
      ? {
          topic: this.options.will.topic,
          payload: Buffer.from(
            await seal(this.options.key, this.options.will.topic, {
              ...(this.options.will.payload as Record<string, unknown>),
              v: PROTOCOL_VERSION,
              lwt: true,
              seq: 0,
              ts: Date.now(),
              src: this.options.clientId,
            }),
          ),
          qos: 1 as const,
          retain: this.options.will.retain,
        }
      : undefined

    // Some public brokers accept MQTT 3.1.1 only, so version 5 falls back to 4.
    try {
      this.client = await this.open(5, will)
    } catch {
      if (this.closed) throw new Error('closed')
      this.client = await this.open(4, will)
    }
    this.attach(this.client)
    this.client.subscribe(this.options.topics.wildcard, { qos: 1 })
    this.options.handlers.onStatus('online')
  }

  private open(
    protocolVersion: 4 | 5,
    will: IClientOptions['will'],
  ): Promise<MqttClient> {
    return new Promise((resolve, reject) => {
      this.options.handlers.onStatus('connecting')
      const client = mqtt.connect(this.options.brokerUrl, {
        clientId: this.options.clientId,
        clean: true,
        keepalive: 30,
        reconnectPeriod: 0, // Reconnection is enabled after the first success.
        connectTimeout: CONNECT_TIMEOUT_MS,
        protocolVersion,
        ...(this.options.username ? { username: this.options.username } : {}),
        ...(this.options.password ? { password: this.options.password } : {}),
        ...(will ? { will } : {}),
      })
      const fail = (error: Error) => {
        client.removeAllListeners()
        client.end(true)
        reject(error)
      }
      client.once('connect', () => {
        // Both guards must go, or a later drop would end the client and stop
        // the reconnection.
        client.removeAllListeners('error')
        client.removeAllListeners('close')
        client.options.reconnectPeriod = 2000
        resolve(client)
      })
      client.once('error', fail)
      client.once('close', () => fail(new Error('closed before connect')))
    })
  }

  private attach(client: MqttClient): void {
    client.on('reconnect', () => this.options.handlers.onStatus('reconnecting'))
    client.on('close', () => {
      if (!this.closed) this.options.handlers.onStatus('offline')
    })
    client.on('error', (error) => this.options.handlers.onStatus('failed', error.message))
    client.on('connect', () => {
      client.subscribe(this.options.topics.wildcard, { qos: 1 })
      this.options.handlers.onStatus('online')
    })
    client.on('message', (topic, payload) => {
      void this.receive(topic, new Uint8Array(payload))
    })
  }

  private async receive(topic: string, payload: Uint8Array): Promise<void> {
    if (payload.length === 0) {
      // A zero length payload clears a retained topic.
      this.guard.reset(topic)
      this.options.handlers.onCleared(topic)
      return
    }
    const message = await open(this.options.key, topic, payload)
    if (message === null) {
      this.options.handlers.onUndecryptable(topic)
      return
    }
    const rejection = this.guard.accept(topic, message)
    if (rejection !== null) {
      this.options.handlers.onRejected?.(topic, rejection)
      return
    }
    this.options.handlers.onMessage(topic, message as Record<string, unknown>)
  }

  private nextSeq(topic: string): number {
    let source = this.seqs.get(topic)
    if (!source) {
      source = new SeqSource()
      this.seqs.set(topic, source)
    }
    return source.next()
  }

  async publish(topic: string, body: object, options: { retain: boolean }): Promise<void> {
    const client = this.client
    if (!client) return
    const message = {
      ...body,
      v: PROTOCOL_VERSION,
      seq: this.nextSeq(topic),
      ts: Date.now(),
      src: this.options.clientId,
    }
    const payload = await seal(this.options.key, topic, message)
    client.publish(topic, Buffer.from(payload), { qos: 1, retain: options.retain })
  }

  /**
   * Publishes clear text, with no envelope and no encryption.
   * Only the open room list uses this: a lobby has no room key, so it could
   * not read a sealed payload. The message carries no secret.
   */
  publishRaw(topic: string, body: object, options: { retain: boolean }): void {
    this.client?.publish(topic, JSON.stringify(body), { qos: 1, retain: options.retain })
  }

  /** Clears a retained topic. A stale round must not reach the next joiner. */
  clearRetained(topic: string): void {
    this.guard.reset(topic)
    this.client?.publish(topic, Buffer.alloc(0), { qos: 1, retain: true })
  }

  close(): void {
    this.closed = true
    this.client?.end(true)
    this.client = null
  }
}
