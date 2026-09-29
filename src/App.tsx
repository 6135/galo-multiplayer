import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { Lobby } from './screens/Lobby'
import { Room } from './screens/Room'
import { useGameStore } from './store/gameStore'

/** GitHub Pages has no SPA fallback, so the router works on the hash. */
export default function App() {
  return (
    <HashRouter>
      <PhaseRouter />
    </HashRouter>
  )
}

function PhaseRouter() {
  const phase = useGameStore((state) => state.phase)
  const navigate = useNavigate()

  useEffect(() => {
    if (phase === 'in_room') navigate('/room')
    if (phase === 'lobby' || phase === 'error') navigate('/')
  }, [phase, navigate])

  return (
    <Routes>
      <Route path="/" element={<Lobby />} />
      <Route path="/room" element={phase === 'in_room' ? <Room /> : <Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
