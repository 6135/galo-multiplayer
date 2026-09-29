/** Runs the search off the main thread, so the board stays responsive. */

import { chooseMove, type AiRequest } from './mcts'

const scope = self as unknown as Worker

scope.onmessage = (event: MessageEvent<{ id: number; request: AiRequest }>) => {
  const { id, request } = event.data
  scope.postMessage({ id, cell: chooseMove(request) })
}
