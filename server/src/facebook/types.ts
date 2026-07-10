export interface LoginResult {
  success: boolean
  pages?: Array<{ pageId: string; pageName: string; accessToken: string }>
  error?: string
}

export interface RequestCodeHelper {
  get: (page: any, currentUrl: string) => Promise<string>
  screenshot: (page: any, caption: string) => Promise<void>
}
