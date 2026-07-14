import { Server as HttpServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { manager } from '../services/whatsapp'
import { log } from '../utils/logger'

export function setupWebSocket(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.FRONTEND_URL,
      methods: ['GET', 'POST'],
    },
  })

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token
    if (!token || typeof token !== 'string') {
      next(new Error('Authentication required'))
      return
    }
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as { userId: string }
      ;(socket as any).userId = decoded.userId
      socket.join(`user:${decoded.userId}`)
      next()
    } catch {
      next(new Error('Invalid token'))
    }
  })

  manager.setSocketIO(io)

  io.on('connection', (socket) => {
    const userId = (socket as any).userId as string
    log('info', 'system', 'Client connected to WebSocket', { socketId: socket.id, userId })

    const state = manager.getStatus(userId)
    socket.emit('whatsapp:state', state)

    const latestQr = manager.getQr(userId)
    if (latestQr) socket.emit('whatsapp:qr', { qr: latestQr })

    socket.on('whatsapp:connect', () => {
      log('info', 'whatsapp', 'Client requested WhatsApp connection', { userId })
      manager.connect(userId).catch((err) => {
        log('error', 'whatsapp', 'Failed to connect WhatsApp', { userId, error: (err as Error).message })
      })
    })

    socket.on('disconnect', () => {
      log('info', 'system', 'Client disconnected from WebSocket', { socketId: socket.id, userId })
    })
  })

  log('info', 'system', 'WebSocket server initialized')
  return io
}
