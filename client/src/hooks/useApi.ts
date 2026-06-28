import { useState, useCallback } from 'react'

const API_URL = import.meta.env.VITE_API_URL || ''
const REQUEST_TIMEOUT = 10000

function getToken(): string | null {
  return localStorage.getItem('token')
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
      signal: controller.signal,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  } finally {
    clearTimeout(timeout)
  }
}

export function useApi() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const get = useCallback(async <T>(endpoint: string): Promise<T> => {
    setLoading(true)
    setError(null)
    try {
      const data = await request<T>(endpoint)
      return data
    } catch (err) {
      const message = (err as Error).name === 'AbortError'
        ? 'Request timed out'
        : (err as Error).message
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const post = useCallback(async <T>(endpoint: string, body?: unknown): Promise<T> => {
    setLoading(true)
    setError(null)
    try {
      const data = await request<T>(endpoint, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      })
      return data
    } catch (err) {
      const message = (err as Error).name === 'AbortError'
        ? 'Request timed out'
        : (err as Error).message
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const put = useCallback(async <T>(endpoint: string, body?: unknown): Promise<T> => {
    setLoading(true)
    setError(null)
    try {
      const data = await request<T>(endpoint, {
        method: 'PUT',
        body: body ? JSON.stringify(body) : undefined,
      })
      return data
    } catch (err) {
      const message = (err as Error).name === 'AbortError'
        ? 'Request timed out'
        : (err as Error).message
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const del = useCallback(async <T>(endpoint: string): Promise<T> => {
    setLoading(true)
    setError(null)
    try {
      const data = await request<T>(endpoint, { method: 'DELETE' })
      return data
    } catch (err) {
      const message = (err as Error).name === 'AbortError'
        ? 'Request timed out'
        : (err as Error).message
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  return { get, post, put, del, loading, error }
}
