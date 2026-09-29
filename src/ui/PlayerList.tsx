/** The roster. Shows the symbol, the score, the connection state and the turn. */

import { ranking } from '../game/roomReducer'
import type { Player } from '../game/types'
import { seatColor } from './seats'

type Props = {
  players: Player[]
  order: string[]
  turnPlayerId: string | null
  hostPlayerId: string
  meId: string
}

export function PlayerList({ players, order, turnPlayerId, hostPlayerId, meId }: Props) {
  return (
    <ul className="players">
      {ranking(players).map((player) => (
        <li key={player.id} className={player.id === meId ? 'player player--me' : 'player'}>
          <span className={player.connected ? 'dot dot--on' : 'dot dot--off'} aria-hidden />
          <span className="player__symbol" style={{ color: seatColor(order.indexOf(player.id)) }}>
            {player.symbol || '·'}
          </span>
          <span className="player__name">{player.name}</span>
          {player.id === hostPlayerId && <span className="tag">anfitrião</span>}
          {player.id === turnPlayerId && <span className="tag tag--turn">vez</span>}
          <span className="player__score">{player.score}</span>
        </li>
      ))}
    </ul>
  )
}
