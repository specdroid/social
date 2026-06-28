import { Server as HttpServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { env } from '../config/env'
import { setSocketIO, getLatestQrDataUrl, getConnectionState, restartWhatsApp } from '../services/whatsappBot'
import { log } from '../utils/logger'

export function setupWebSocket(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.FRONTEND_URL,
      methods: ['GET', 'POST'],
    },
  })

  io.on('connection', (socket) => {
    log('info', 'system', 'Client connected to WebSocket', { socketId: socket.id })

    socket.emit('whatsapp:state', getConnectionState())

    const latestQr = getLatestQrDataUrl()
    if (latestQr) {
      socket.emit('whatsapp:qr', { qr: latestQr })
    }

    socket.on('whatsapp:connect', () => {
      log('info', 'whatsapp', 'Client requested WhatsApp connection restart')
      restartWhatsApp(io).catch((err) => {
        log('error', 'whatsapp', 'Failed to restart WhatsApp on client request', {
          error: (err as Error).message,
        })
      })
    })

    socket.on('disconnect', () => {
      log('info', 'system', 'Client disconnected from WebSocket', { socketId: socket.id })
    })
  })

  setSocketIO(io)

  log('info', 'system', 'WebSocket server initialized')
  return io
}
