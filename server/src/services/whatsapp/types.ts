import type { WAMessage } from '@whiskeysockets/baileys'

export interface ContactEntry {
  id: string
  lid?: string
  name?: string
  notify?: string
  verifiedName?: string
  phoneNumber?: string
}

export interface CreateRuleWizard {
  name: string
  platform?: number
  triggerValues?: string[]
  contactJids?: string[]
  contactGroupIds?: string[]
  contactGroupNames?: string[]
  savedGroupListNames?: string[]
  replyText?: string
  mediaTypeCode?: number
  step: number
  createdAt: number
}

export interface ChannelSelection {
  options: Array<{ name: string; id: string }>
  limit: number
  showTime: boolean
}

export interface ConnectionState {
  connected: boolean
  connecting: boolean
  attempt: number
  maxAttempts: number
  qrAvailable: boolean
}

export interface ProcessCommandsParams {
  sock: any
  sender: string
  actualSender: string
  textContent: string
  message: WAMessage
  allGroups: Record<string, any>
  myJids: string[]
}
