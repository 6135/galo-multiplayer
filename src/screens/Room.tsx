/** The room. One screen for every status and every role. */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Banner } from '../ui/Banner'
import { Grid } from '../ui/Grid'
import { History } from '../ui/History'
import { PlayerList } from '../ui/PlayerList'
import { HostPanel } from '../roles/host/HostPanel'
import { leaveRoom, playCell } from '../roles/roomSession'
import { useGameStore } from '../store/gameStore'
import { ranking } from '../game/roomReducer'
import { useCues } from '../ui/useCues'
import { isMuted, play, setMuted } from '../ui/sound'

const STATUS: Record<string, string> = {
  lobby: 'átrio',
  playing: 'a jogar',
  round_end: 'fim da ronda',
  game_over: 'fim do jogo',
}

function shareLink(roomName: string): string {
  const base = `${location.origin}${location.pathname}`
  return `${base}#/?room=${encodeURIComponent(roomName)}`
}

export function Room() {
  const navigate = useNavigate()
  const identity = useGameStore((state) => state.identity)
  const roster = useGameStore((state) => state.roster)
  const storedRound = useGameStore((state) => state.round)
  const link = useGameStore((state) => state.link)
  const notice = useGameStore((state) => state.notice)
  const [quiet, setQuiet] = useState(isMuted())
  const [showHistory, setShowHistory] = useState(false)

  // Hooks run before the early return, so the cues survive a slow first state.
  useCues(identity?.playerId ?? '')

  function toggleSound(): void {
    const next = !quiet
    setQuiet(next)
    setMuted(next)
    // The click is the gesture that lets the browser open the audio context.
    if (!next) play('hit')
  }

  if (!identity || !roster) {
    return (
      <main className="screen">
        <p>A carregar a sala…</p>
      </main>
    )
  }

  // A board from another round number is stale and never renders.
  const round =
    storedRound && storedRound.roundNumber === roster.roundNumber && roster.status !== 'lobby'
      ? storedRound
      : null
  const isHost = identity.role === 'host'
  const blocked = link !== 'online'
  const nameOf = (id: string | null) =>
    roster.players.find((player) => player.id === id)?.name ?? null
  const seated = roster.order.includes(identity.playerId)
  const turnName = nameOf(round?.turnPlayerId ?? null)
  const myTurn = round?.outcome === 'running' && round.turnPlayerId === identity.playerId

  async function leave(): Promise<void> {
    await leaveRoom()
    navigate('/')
  }

  return (
    <main className="screen screen--room">
      <header className="room__head">
        <div>
          <h1>{identity.roomName}</h1>
          <p className="hint">
            Ronda {roster.roundNumber} · {STATUS[roster.status] ?? roster.status}
          </p>
        </div>
        <div className="actions">
          <button type="button" onClick={() => setShowHistory(!showHistory)}>
            Histórico{roster.history.length > 0 ? ` (${roster.history.length})` : ''}
          </button>
          <button
            type="button"
            className="icon"
            aria-label={quiet ? 'Ligar o som' : 'Desligar o som'}
            title={quiet ? 'Ligar o som' : 'Desligar o som'}
            onClick={toggleSound}
          >
            {quiet ? '🔇' : '🔊'}
          </button>
          <button type="button" onClick={() => void leave()}>
            {isHost ? 'Fechar a sala' : 'Sair'}
          </button>
        </div>
      </header>

      <Banner status={link} />
      {notice && <p className="notice">{notice}</p>}

      <div className="room__grid">
        <div className="room__main">
          {showHistory && <History roster={roster} onClose={() => setShowHistory(false)} />}

          {!showHistory && roster.status === 'lobby' && (
            <section className="card">
              <h2>À espera de jogadores</h2>
              <p className="hint">
                Partilhe o nome da sala e a chave. O link leva o nome, nunca a chave. A grelha
                cresce com o número de jogadores.
              </p>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(shareLink(identity.roomName))}
              >
                Copiar o link
              </button>
            </section>
          )}

          {!showHistory && round && (
            <section className="card board">
              <p className="board__status" aria-live="polite">
                {round.outcome === 'won'
                  ? `${nameOf(round.winnerId) ?? '—'} ganhou.`
                  : round.outcome === 'draw'
                    ? 'Empate.'
                    : myTurn
                      ? 'É a sua vez.'
                      : `Vez de ${turnName ?? 'ninguém'}.`}
              </p>
              <Grid
                round={round}
                players={roster.players}
                order={roster.order}
                meId={identity.playerId}
                canPlay={!blocked && seated && roster.status === 'playing'}
                onPlay={(cell) => void playCell(cell)}
              />
              <p className="hint">
                {round.size}×{round.size} · {round.winLength} em linha para ganhar ·{' '}
                {round.moves.length} jogada(s)
                {!seated && ' · está a assistir'}
              </p>
            </section>
          )}

          {!showHistory && roster.status === 'round_end' && roster.lastRound?.voided && (
            <section className="card">
              <h2>Ronda anulada</h2>
              <p>Ninguém marcou.</p>
            </section>
          )}

          {!showHistory && roster.status === 'game_over' && (
            <section className="card">
              <h2>Fim do jogo</h2>
              <ol className="ranking">
                {ranking(roster.players).map((player) => (
                  <li key={player.id}>
                    <span>
                      {player.symbol} {player.name}
                    </span>
                    <strong>{player.score}</strong>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <aside className="room__side">
          <PlayerList
            players={roster.players}
            order={roster.order}
            turnPlayerId={round?.outcome === 'running' ? round.turnPlayerId : null}
            hostPlayerId={roster.hostPlayerId}
            meId={identity.playerId}
          />

          {isHost && <HostPanel roster={roster} blocked={blocked} />}
        </aside>
      </div>
    </main>
  )
}
