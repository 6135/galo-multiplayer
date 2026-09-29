/**
 * Short cues, built with WebAudio. No audio file, so the bundle does not grow.
 *
 * A browser blocks audio until the person acts on the page. The context is
 * therefore created on the first cue and resumed when it is suspended. Every
 * device in a room hears the same cue, because the cues follow the published
 * state, not the local input.
 */

export type Cue = 'hit' | 'turn' | 'win' | 'lose' | 'join' | 'over'

type Note = {
  /** Start, in seconds after the cue. */
  at: number
  dur: number
  freq: number
  /** Slides to this frequency across the note. */
  to?: number
  type?: OscillatorType
  gain?: number
}

const CUES: Record<Cue, Note[]> = {
  // A mark on the board.
  hit: [{ at: 0, dur: 0.12, freq: 880, type: 'sine', gain: 0.18 }],
  // Your turn to play.
  turn: [
    { at: 0, dur: 0.1, freq: 660 },
    { at: 0.1, dur: 0.16, freq: 990 },
  ],
  win: [
    { at: 0, dur: 0.11, freq: 523 },
    { at: 0.11, dur: 0.11, freq: 659 },
    { at: 0.22, dur: 0.11, freq: 784 },
    { at: 0.33, dur: 0.3, freq: 1047 },
  ],
  lose: [
    { at: 0, dur: 0.16, freq: 392, type: 'triangle' },
    { at: 0.16, dur: 0.16, freq: 311, type: 'triangle' },
    { at: 0.32, dur: 0.4, freq: 233, type: 'triangle', gain: 0.16 },
  ],
  // A player entered the room.
  join: [{ at: 0, dur: 0.08, freq: 1200, type: 'sine', gain: 0.1 }],
  over: [
    { at: 0, dur: 0.14, freq: 784 },
    { at: 0.14, dur: 0.14, freq: 659 },
    { at: 0.28, dur: 0.14, freq: 523 },
    { at: 0.42, dur: 0.45, freq: 392, gain: 0.16 },
  ],
}

const STORAGE_KEY = 'galo.sound'

let context: AudioContext | null = null
let muted = readMuted()

function readMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'off'
  } catch {
    return false
  }
}

export function isMuted(): boolean {
  return muted
}

export function setMuted(value: boolean): void {
  muted = value
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'off' : 'on')
  } catch {
    /* A blocked storage must not break the sound. */
  }
}

function audio(): AudioContext | null {
  if (context) return context
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    context = new Ctor()
  } catch {
    return null
  }
  return context
}

/** Plays one cue. A failure stays silent: sound is never worth an error. */
export function play(cue: Cue): void {
  if (muted) return
  const ctx = audio()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume()

  const start = ctx.currentTime + 0.01
  for (const note of CUES[cue]) {
    try {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const at = start + note.at
      const level = note.gain ?? 0.15

      osc.type = note.type ?? 'square'
      osc.frequency.setValueAtTime(note.freq, at)
      if (note.to !== undefined) osc.frequency.linearRampToValueAtTime(note.to, at + note.dur)

      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.linearRampToValueAtTime(level, at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + note.dur)

      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(at)
      osc.stop(at + note.dur + 0.02)
    } catch {
      /* One broken note must not stop the rest. */
    }
  }
}
