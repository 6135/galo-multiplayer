/** The board. The grid grows with the number of players. */

import type { Player, RoundState } from '../game/types'
import { seatColor } from './seats'

type Props = {
  round: RoundState
  players: Player[]
  order: string[]
  meId: string
  canPlay: boolean
  onPlay: (cell: number) => void
}

export function Grid({ round, players, order, meId, canPlay, onPlay }: Props) {
  const byId = new Map(players.map((player) => [player.id, player]))
  const winning = new Set(round.line)
  const last = round.moves[round.moves.length - 1]
  const myTurn = canPlay && round.outcome === 'running' && round.turnPlayerId === meId

  return (
    <div
      className={myTurn ? 'grid grid--mine' : 'grid'}
      style={{ gridTemplateColumns: `repeat(${round.size}, 1fr)`, ['--n' as string]: round.size }}
      role="grid"
      aria-label={`Grelha ${round.size} por ${round.size}`}
    >
      {round.cells.map((owner, index) => {
        const player = owner ? byId.get(owner) : undefined
        const row = Math.floor(index / round.size) + 1
        const col = (index % round.size) + 1
        const classes = ['cell']
        if (winning.has(index)) classes.push('cell--win')
        if (index === last) classes.push('cell--last')
        return (
          <button
            key={index}
            type="button"
            className={classes.join(' ')}
            style={owner ? { color: seatColor(order.indexOf(owner)) } : undefined}
            disabled={!myTurn || owner !== null}
            aria-label={`Linha ${row}, coluna ${col}${player ? `, ${player.name}` : ''}`}
            onClick={() => onPlay(index)}
          >
            {player?.symbol ?? ''}
          </button>
        )
      })}
    </div>
  )
}
