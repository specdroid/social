import { useEffect, useState } from 'react'
import { io, Socket } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_API_URL || ''

interface UseSocketResult {
  socket: Socket | null
  connected: boolean
}

export function useSocket(): UseSocketResult {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('token')
    const s = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      auth: { token },
    })

    setSocket(s)

    s.on('connect', () => setConnected(true))
    s.on('disconnect', () => setConnected(false))

    return () => {
      s.disconnect()
    }
  }, [])

  return { socket, connected }
}
