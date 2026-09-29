/** Host controls: the configuration, the start, the next round and the export. */

import { useEffect, useState } from 'react'
import { ranking } from '../../game/roomReducer'
import { gridSize, MAX_PLAYERS, MIN_PLAYERS } from '../../game/order'
import { effectiveWinLength, MAX_WIN_LENGTH, MIN_WIN_LENGTH } from '../../game/roundReducer'
import { hostApi } from '../roomSession'
import { LEVELS } from '../../game/ai/bot'
import type { BotLevel, RoomState } from '../../game/types'

function exportRanking(roster: RoomState): void {
  const payload = {
    rounds: roster.roundNumber,
    exportedAt: new Date().toISOString(),
    ranking: ranking(roster.players).map((player) => ({
      name: player.name,
      symbol: player.symbol,
      score: player.score,
    })),
  }
  const text = JSON.stringify(payload, null, 2)
  void navigator.clipboard?.writeText(text)
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'galo-ranking.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

export function HostPanel({ roster, blocked }: { roster: RoomState; blocked: boolean }) {
  const connected = roster.players.filter((player) => player.connected).length
  const [armed, setArmed] = useState(false)
  const [level, setLevel] = useState<BotLevel>('normal')
  const bots = roster.players.filter((player) => player.bot)
  const full = roster.players.length >= MAX_PLAYERS
  const live = roster.status === 'playing'
  const size = gridSize(Math.min(connected, MAX_PLAYERS))
  const winLength = effectiveWinLength(roster.config.winLength, size)

  // A restart in the middle of a game asks for a second click, and forgets it.
  useEffect(() => {
    if (!armed) return undefined
    const timer = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [armed])

  function restart(): void {
    if (live && !armed) {
      setArmed(true)
      return
    }
    setArmed(false)
    void hostApi.restart()
  }

  return (
    <section className="panel panel--host">
      <h3>Anfitrião</h3>

      {roster.status === 'lobby' && (
        <>
          <div className="bots">
            <h4>Bots</h4>
            <div className="row">
              <select
                aria-label="Nível do bot"
                value={level}
                onChange={(event) => setLevel(event.target.value as BotLevel)}
              >
                {(Object.keys(LEVELS) as BotLevel[]).map((key) => (
                  <option key={key} value={key}>
                    {LEVELS[key].label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={blocked || full}
                onClick={() => void hostApi.addBot(level)}
              >
                Adicionar bot
              </button>
            </div>
            {bots.length > 0 && (
              <ul className="bots__list">
                {bots.map((bot) => (
                  <li key={bot.id}>
                    <span>
                      {bot.name} · {LEVELS[bot.bot!].label}
                    </span>
                    <button
                      type="button"
                      className="chip"
                      aria-label={`Remover ${bot.name}`}
                      disabled={blocked}
                      onClick={() => void hostApi.removeBot(bot.id)}
                    >
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="hint">
              Sozinho? Adicione bots para jogar. Os bots jogam neste dispositivo e só existem se os
              adicionar.
            </p>
          </div>
          <label className="row">
            Em linha para ganhar
            <input
              type="number"
              min={MIN_WIN_LENGTH}
              max={MAX_WIN_LENGTH}
              value={roster.config.winLength}
              onChange={(event) => void hostApi.setConfig({ winLength: Number(event.target.value) })}
            />
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={roster.config.onePassLimit}
              onChange={(event) => void hostApi.setConfig({ onePassLimit: event.target.checked })}
            />
            Uma ronda por jogador
          </label>
          <p className="hint">
            Com {connected} jogador(es) a grelha é {size}×{size} e ganha quem fizer {winLength} em
            linha.
          </p>
          <button
            type="button"
            className="primary"
            disabled={blocked || connected < MIN_PLAYERS}
            onClick={() => void hostApi.startGame()}
          >
            Começar o jogo
          </button>
          {connected < MIN_PLAYERS && <p className="hint">São precisos dois jogadores ligados. Um bot conta como jogador.</p>}
          {connected > MAX_PLAYERS && (
            <p className="hint">Só os primeiros {MAX_PLAYERS} jogadores sorteados jogam.</p>
          )}
        </>
      )}

      {roster.status === 'round_end' && (
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={blocked}
            onClick={() => void hostApi.nextRound()}
          >
            Próxima ronda
          </button>
          <button type="button" disabled={blocked} onClick={() => void hostApi.endGame()}>
            Terminar o jogo
          </button>
        </div>
      )}

      {live && (
        <button type="button" disabled={blocked} onClick={() => void hostApi.voidRound()}>
          Anular a ronda
        </button>
      )}

      {roster.status === 'game_over' && (
        <button type="button" onClick={() => exportRanking(roster)}>
          Exportar a classificação
        </button>
      )}

      {roster.status !== 'lobby' && (
        <>
          <button
            type="button"
            className={armed ? 'primary' : ''}
            disabled={blocked}
            onClick={restart}
          >
            {armed ? 'Confirmar o reinício' : 'Reiniciar a sala'}
          </button>
          <p className="hint">
            Volta ao átrio com os mesmos jogadores. Os pontos vão a zero, a ordem e os símbolos são
            sorteados outra vez. Ninguém sai da sala.
          </p>
        </>
      )}

      <p className="hint">A sala fecha quando o anfitrião sai. A classificação perde-se.</p>
    </section>
  )
}
