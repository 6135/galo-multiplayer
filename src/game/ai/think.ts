/** Asks the worker for a move. Falls back to the main thread when no worker works. */

import { search, type AiRequest, type SearchMemory } from './mcts'

type Pending = { request: AiRequest; resolve: (cell: number) => void }

let worker: Worker | null = null
/** Used only when no worker works. */
const memory: SearchMemory = new Map()
let broken = false
let nextId = 1
const pending = new Map<number, Pending>()

/** A worker that fails must never leave a bot without a move. */
function fallBack(): void {
  broken = true
  worker?.terminate()
  worker = null
  for (const [id, job] of pending) {
    pending.delete(id)
    job.resolve(search(job.request, Math.random, memory).cell)
  }
}

function getWorker(): Worker | null {
  if (worker) return worker
  if (broken || typeof Worker === 'undefined') return null
  try {
    worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    broken = true
    return null
  }
  worker.onmessage = (event: MessageEvent<{ id: number; cell: number }>) => {
    pending.get(event.data.id)?.resolve(event.data.cell)
    pending.delete(event.data.id)
  }
  worker.onerror = () => fallBack()
  return worker
}

export function think(request: AiRequest): Promise<number> {
  const target = getWorker()
  if (!target) return Promise.resolve(search(request, Math.random, memory).cell)
  const id = nextId
  nextId += 1
  return new Promise((resolve) => {
    pending.set(id, { request, resolve })
    target.postMessage({ id, request })
  })
}
