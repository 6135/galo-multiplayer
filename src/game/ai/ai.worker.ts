/** Runs the search off the main thread, so the board stays responsive. */

import { search, type AiRequest, type SearchMemory } from './mcts'

const scope = self as unknown as Worker
/** The tree of each bot lives here between its turns. */
const memory: SearchMemory = new Map()

scope.onmessage = (event: MessageEvent<{ id: number; request: AiRequest }>) => {
  const { id, request } = event.data
  scope.postMessage({ id, cell: search(request, Math.random, memory).cell })
}
