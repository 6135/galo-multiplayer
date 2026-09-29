/** Plays the cues that a state change asks for. */

import { useEffect, useRef } from 'react'
import { useGameStore } from '../store/gameStore'
import { cuesFor, type Snapshot } from './cues'
import { play } from './sound'

/** A second cue waits, so two cues never land on the same instant. */
const SPACING_MS = 180

export function useCues(meId: string): void {
  const me = useRef(meId)
  me.current = meId

  useEffect(() => {
    let previous: Snapshot = {
      roster: useGameStore.getState().roster,
      round: useGameStore.getState().round,
    }
    const timers: ReturnType<typeof setTimeout>[] = []

    const stop = useGameStore.subscribe((state) => {
      const next: Snapshot = { roster: state.roster, round: state.round }
      if (next.roster === previous.roster && next.round === previous.round) return
      const cues = cuesFor(previous, next, me.current)
      previous = next
      cues.forEach((cue, index) => {
        if (index === 0) play(cue)
        else timers.push(setTimeout(() => play(cue), index * SPACING_MS))
      })
    })

    return () => {
      stop()
      for (const timer of timers) clearTimeout(timer)
    }
  }, [])
}
