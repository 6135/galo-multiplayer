/** PBKDF2 key derivation and the AES-GCM envelope. */

import { PROTOCOL } from './topics'

const PBKDF2_ITERATIONS = 210_000
const ENVELOPE_VERSION = 0x01
const IV_BYTES = 12

/**
 * Derive the room key once at join time. Keep the CryptoKey in memory only.
 * Never write the room key or the derived key to localStorage.
 */
export async function deriveRoomCryptoKey(roomKey: string, roomId: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(roomKey),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(`${PROTOCOL}/${roomId}`),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Encrypt a plaintext object for one topic.
 * Layout: version byte, 12 byte IV, ciphertext with the 16 byte tag.
 * The topic is the additional authenticated data, so a payload cannot move
 * to another topic.
 */
export async function seal(key: CryptoKey, topic: string, plaintext: unknown): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const data = new TextEncoder().encode(JSON.stringify(plaintext))
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(topic) },
      key,
      data,
    ),
  )
  const out = new Uint8Array(1 + IV_BYTES + cipher.length)
  out[0] = ENVELOPE_VERSION
  out.set(iv, 1)
  out.set(cipher, 1 + IV_BYTES)
  return out
}

/** Decrypt a payload. Returns null on any failure. The caller stays silent. */
export async function open(key: CryptoKey, topic: string, payload: Uint8Array): Promise<unknown> {
  if (payload.length < 1 + IV_BYTES + 16) return null
  if (payload[0] !== ENVELOPE_VERSION) return null
  // Copy into a plain ArrayBuffer. A view over a shared buffer is not a
  // BufferSource for WebCrypto.
  const bytes = new Uint8Array(payload.length)
  bytes.set(payload)
  const iv = bytes.subarray(1, 1 + IV_BYTES)
  const cipher = bytes.subarray(1 + IV_BYTES)
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(topic) },
      key,
      cipher,
    )
    return JSON.parse(new TextDecoder().decode(plain))
  } catch {
    return null
  }
}
