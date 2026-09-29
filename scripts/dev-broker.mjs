/**
 * Local MQTT broker over WebSockets, for development without a public broker.
 * Point the lobby broker field at ws://127.0.0.1:1884.
 */
import { createServer } from 'node:http'
import { Aedes } from 'aedes'
import { WebSocketServer, createWebSocketStream } from 'ws'

const port = Number(process.env.BROKER_PORT ?? 1884)
const broker = await Aedes.createBroker()
const http = createServer()

const wss = new WebSocketServer({
  server: http,
  // The browser fails the handshake when the server does not echo a subprotocol.
  handleProtocols: (protocols) => (protocols.has('mqtt') ? 'mqtt' : false),
})

wss.on('connection', (socket) => {
  broker.handle(createWebSocketStream(socket))
})

http.listen(port, () => {
  console.log(`broker on ws://127.0.0.1:${port}`)
})
