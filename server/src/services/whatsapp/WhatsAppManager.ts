import { Server as SocketIOServer } from 'socket.io'
import { PrismaClient } from '@prisma/client'
import { UserWhatsAppManager } from './UserWhatsAppManager'
import { log } from '../../utils/logger'
import type { ConnectionState } from './types'

const prisma = new PrismaClient()

class WhatsAppManagerSingleton {
  private instances = new Map<string, UserWhatsAppManager>()
  private io: SocketIOServer | null = null

  setSocketIO(io: SocketIOServer): void {
    this.io = io
  }

  getSocketIO(): SocketIOServer | null {
    return this.io
  }

  async connect(userId: string): Promise<void> {
    const existing = this.instances.get(userId)
    if (existing) {
      const state = existing.getConnectionState()
      if (state.connected || state.connecting) {
        log('info', 'whatsapp', `User ${userId} already connected/connecting`)
        return
      }
      await existing.cleanup()
    }

    const manager = new UserWhatsAppManager(userId, this.io!)
    this.instances.set(userId, manager)
    await manager.init()
  }

  async disconnect(userId: string): Promise<void> {
    const instance = this.instances.get(userId)
    if (instance) {
      await instance.cleanup()
      this.instances.delete(userId)
    }

    await prisma.whatsAppSession.updateMany({
      where: { userId },
      data: { isConnected: false },
    })
  }

  getStatus(userId: string): ConnectionState {
    const instance = this.instances.get(userId)
    if (!instance) {
      return { connected: false, connecting: false, attempt: 0, maxAttempts: 3, qrAvailable: false }
    }
    return instance.getConnectionState()
  }

  getQr(userId: string): string | null {
    const instance = this.instances.get(userId)
    return instance?.getQrDataUrl() || null
  }

  isOwnerConnected(userId: string): boolean {
    const instance = this.instances.get(userId)
    return instance?.getConnectionState().connected || false
  }

  getInstance(userId: string): UserWhatsAppManager | undefined {
    return this.instances.get(userId)
  }

  broadcast(event: string, data: Record<string, unknown>): void {
    if (this.io) this.io.emit(event, data)
  }

  emitTo(userId: string, event: string, data: Record<string, unknown>): void {
    if (this.io) {
      this.io.to(`user:${userId}`).emit(event, data)
    }
  }
}

export const manager = new WhatsAppManagerSingleton()
