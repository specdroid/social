import type { Page } from 'playwright'

export interface LoginResult {
  success: boolean
  pages?: Array<{ pageId: string; pageName: string; accessToken: string }>
  error?: string
}

export interface RequestCodeHelper {
  get: (page: Page, currentUrl: string) => Promise<string>
  screenshot: (page: Page, caption: string) => Promise<void>
}
