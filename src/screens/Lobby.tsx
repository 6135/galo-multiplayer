/** Entry screen. Creates a room or joins one. */

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createRoom, joinRoom, DEFAULT_BROKER, type Credentials } from '../roles/roomSession'
import { prefs, useGameStore } from '../store/gameStore'
import { watchDirectory } from '../net/directory'
import type { RoomAd } from '../game/types'

const BROKERS = [
  { label: 'HiveMQ público', url: DEFAULT_BROKER },
  { label: 'EMQX público', url: 'wss://broker.emqx.io:8084/mqtt' },
]

export function Lobby() {
  const [params] = useSearchParams()
  const stored = prefs.read()
  const [roomName, setRoomName] = useState(params.get('room') ?? stored.roomName)
  const [roomKey, setRoomKey] = useState('')
  const [playerName, setPlayerName] = useState(stored.name)
  const [brokerUrl, setBrokerUrl] = useState(stored.broker || DEFAULT_BROKER)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [listRoom, setListRoom] = useState(true)
  const [rooms, setRooms] = useState<RoomAd[]>([])
  const [picked, setPicked] = useState<RoomAd | null>(null)
  const keyInput = useRef<HTMLInputElement>(null)
  const phase = useGameStore((state) => state.phase)
  const error = useGameStore((state) => state.error)
  const busy = phase === 'connecting'

  useEffect(() => {
    const fromLink = params.get('room')
    if (fromLink) setRoomName(fromLink)
  }, [params])

  // The open list is a convenience, so it runs on its own connection and a
  // broker that refuses it changes nothing else on this screen.
  useEffect(() => {
    if (!/^wss?:\/\//.test(brokerUrl)) {
      setRooms([])
      return undefined
    }
    const stop = watchDirectory(brokerUrl, setRooms)
    return () => stop()
  }, [brokerUrl])

  const ready = roomName.trim().length > 0 && roomKey.length > 0 && playerName.trim().length > 0

  function pick(room: RoomAd): void {
    setPicked(room)
    setRoomName(room.name)
    keyInput.current?.focus()
  }

  function typeRoomName(value: string): void {
    setRoomName(value)
    // A hand written name no longer belongs to the room that was picked.
    if (picked && value !== picked.name) setPicked(null)
  }

  function credentials(): Credentials {
    prefs.write({ name: playerName.trim(), broker: brokerUrl, roomName: roomName.trim() })
    return {
      roomName,
      roomKey,
      playerName,
      brokerUrl,
      listRoom,
      ...(picked && picked.name === roomName ? { roomId: picked.roomId } : {}),
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
    }
  }

  return (
    <main className="screen screen--lobby">
      <h1>Galo Multiplayer</h1>
      <p className="lead">
        Sem servidor. O estado passa por um broker MQTT público e vai cifrado com a chave da sala.
      </p>

      {error && <p className="error">{error}</p>}

      <form className="card" onSubmit={(event) => event.preventDefault()}>
        <label>
          Nome da sala
          <input
            value={roomName}
            onChange={(event) => typeRoomName(event.target.value)}
            placeholder="sala dos amigos"
            autoComplete="off"
          />
        </label>
        <label>
          Chave da sala
          <input
            ref={keyInput}
            type="password"
            value={roomKey}
            onChange={(event) => setRoomKey(event.target.value)}
            placeholder="partilhe fora do link"
            autoComplete="off"
          />
        </label>
        <label>
          O seu nome
          <input
            value={playerName}
            onChange={(event) => setPlayerName(event.target.value)}
            maxLength={24}
            autoComplete="off"
          />
        </label>

        <label className="row">
          <input
            type="checkbox"
            checked={listRoom}
            onChange={(event) => setListRoom(event.target.checked)}
          />
          Mostrar a sala na lista aberta
        </label>

        <button type="button" className="link" onClick={() => setAdvanced(!advanced)}>
          {advanced ? 'Esconder o broker' : 'Broker e credenciais'}
        </button>

        {advanced && (
          <div className="advanced">
            <label>
              Broker (WSS)
              <input value={brokerUrl} onChange={(event) => setBrokerUrl(event.target.value)} />
            </label>
            <div className="presets">
              {BROKERS.map((broker) => (
                <button
                  key={broker.url}
                  type="button"
                  className="chip"
                  onClick={() => setBrokerUrl(broker.url)}
                >
                  {broker.label}
                </button>
              ))}
            </div>
            <label>
              Utilizador (opcional)
              <input value={username} onChange={(event) => setUsername(event.target.value)} />
            </label>
            <label>
              Palavra-passe (opcional)
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <p className="hint">
              Uma credencial no pacote público é pública. Serve para limitar o espaço de tópicos,
              não para proteger o conteúdo.
            </p>
          </div>
        )}

        <div className="actions">
          <button
            type="submit"
            className="primary"
            disabled={!ready || busy}
            onClick={() => void createRoom(credentials())}
          >
            Criar sala
          </button>
          <button
            type="submit"
            disabled={!ready || busy}
            onClick={() => void joinRoom(credentials())}
          >
            Entrar
          </button>
        </div>
      </form>

      <section className="card rooms">
        <h2>Salas abertas</h2>
        {rooms.length === 0 ? (
          <p className="hint">
            Nenhuma sala na lista. Uma sala só aparece aqui se o anfitrião a mostrar.
          </p>
        ) : (
          <ul className="rooms__list">
            {rooms.map((room) => (
              <li key={room.roomId}>
                <button
                  type="button"
                  className={picked?.roomId === room.roomId ? 'room room--picked' : 'room'}
                  onClick={() => pick(room)}
                >
                  <span className="room__name">{room.name}</span>
                  <span className="tag">{room.players} jogador(es)</span>
                  <span className={room.open ? 'tag tag--turn' : 'tag'}>
                    {room.open ? 'a aceitar' : 'a jogar'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">
          A lista mostra o nome, nunca a chave. Escolha uma sala e escreva a chave para entrar.
        </p>
      </section>

      <p className="hint">
        A chave da sala entra no identificador do tópico e na chave de cifra. Nunca a ponha no link.
      </p>
    </main>
  )
}
