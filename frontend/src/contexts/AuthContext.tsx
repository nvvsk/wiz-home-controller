import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'

interface AuthValue {
  loading: boolean
  authRequired: boolean
  authenticated: boolean
  token: string | null
  loginError: string | null
  login: (password: string) => Promise<boolean>
}

const STORAGE_KEY = 'wiz.auth.token'
const AuthContext = createContext<AuthValue | null>(null)

function decodeExp(token: string): number | null {
  try {
    const body = token.split('.')[1]
    const padded = body.replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(atob(padded + '==='.slice((padded.length + 3) % 4)))
    return typeof json.exp === 'number' ? json.exp * 1000 : null
  } catch {
    return null
  }
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [loading, setLoading] = useState(true)
  const [authRequired, setAuthRequired] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [token, setTokenState] = useState<string | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearToken = () => {
    localStorage.removeItem(STORAGE_KEY)
    setTokenState(null)
    setAuthenticated(false)
    if (expiryTimer.current) { clearTimeout(expiryTimer.current); expiryTimer.current = null }
  }

  const setToken = (t: string) => {
    localStorage.setItem(STORAGE_KEY, t)
    setTokenState(t)
    setAuthenticated(true)
    // Schedule proactive logout when the token expires.
    if (expiryTimer.current) clearTimeout(expiryTimer.current)
    const expMs = decodeExp(t)
    if (expMs) {
      const delay = Math.max(0, expMs - Date.now())
      expiryTimer.current = setTimeout(clearToken, delay)
    }
  }

  // Initial bootstrap: ask /api/auth/status whether auth is required and
  // whether our stored token (if any) is still valid.
  useEffect(() => {
    // Globally inject the bearer token on every /api/* fetch and route 401s
    // to clearToken(). Saves us from rewriting every call site — Scenes.tsx,
    // Automations.tsx etc. all use raw fetch().
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input as Request).url)
      const isApi = url.includes('/api/') || url.endsWith('/api')
      const isAuthEp = url.includes('/api/auth/')
      if (isApi && !isAuthEp) {
        const t = localStorage.getItem(STORAGE_KEY)
        if (t) {
          const headers = new Headers(init.headers || {})
          if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${t}`)
          init = { ...init, headers }
        }
      }
      const res = await originalFetch(input, init)
      if (res.status === 401 && isApi && !isAuthEp) {
        ;(window as any).__wizOnUnauthorized?.()
      }
      return res
    }
    ;(window as any).__wizOnUnauthorized = () => clearToken()

    const saved = localStorage.getItem(STORAGE_KEY)
    originalFetch('/api/auth/status', {
      headers: saved ? { Authorization: `Bearer ${saved}` } : {}
    })
      .then(r => r.json())
      .then(data => {
        setAuthRequired(!!data.authRequired)
        if (!data.authRequired) {
          // Backend has auth off → don't gate anything.
          setAuthenticated(true)
        } else if (data.authenticated && saved) {
          setToken(saved)
        } else {
          clearToken()
        }
      })
      .catch(() => {
        // Server unreachable; assume auth is required and we're not in.
        setAuthRequired(true)
        clearToken()
      })
      .finally(() => setLoading(false))

    return () => {
      window.fetch = originalFetch
      delete (window as any).__wizOnUnauthorized
    }
  }, [])

  const login = async (password: string): Promise<boolean> => {
    setLoginError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setLoginError(body.error || `Login failed (${res.status})`)
        return false
      }
      const data = await res.json()
      if (data.token) setToken(data.token)
      else setAuthenticated(true) // auth disabled server-side
      return true
    } catch (err: any) {
      setLoginError(err?.message || 'Network error')
      return false
    }
  }

  return (
    <AuthContext.Provider value={{ loading, authRequired, authenticated, token, loginError, login }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}

// Helper for non-React modules (api.ts, socket.tsx) to read the current token.
export function getAuthToken(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

// Helper for non-React modules to signal "we got a 401" so the context can
// clear state. Set by AuthProvider on mount.
export function notifyUnauthorized() {
  const fn = (window as any).__wizOnUnauthorized
  if (typeof fn === 'function') fn()
}
