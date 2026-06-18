import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

export interface AuthUser {
  sub: string
  name: string | null
  email: string | null
  username: string | null
  groups: string[]
}

interface AuthValue {
  loading: boolean
  authRequired: boolean
  authenticated: boolean
  user: AuthUser | null
  login: () => void
  logout: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

/**
 * BFF auth model: login state lives in a server-side session (HTTP-only cookie).
 * The browser never sees a token. We only ask the server `am I logged in?` and
 * trigger redirects to `/api/auth/login` / `/api/auth/logout` to start/end the
 * OIDC flow.
 *
 * A global fetch interceptor still maps a 401 on any /api/* call to "session
 * gone — show the login screen," so background API failures during a long-idle
 * tab don't leave the UI stuck.
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [loading, setLoading] = useState(true)
  const [authRequired, setAuthRequired] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    // Intercept all /api/* fetches so a 401 anywhere flips us back to logged out.
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input as Request).url)
      const isApi = url.includes('/api/') || url.endsWith('/api')
      const isAuthEp = url.includes('/api/auth/')
      const res = await originalFetch(input, init)
      if (res.status === 401 && isApi && !isAuthEp) {
        setAuthenticated(false)
        setUser(null)
      }
      return res
    }

    fetch('/api/auth/status', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(data => {
        setAuthRequired(!!data.authRequired)
        if (!data.authRequired) {
          setAuthenticated(true)
          setUser(null)
        } else if (data.authenticated && data.user) {
          setAuthenticated(true)
          setUser(data.user)
        } else {
          setAuthenticated(false)
          setUser(null)
        }
      })
      .catch(() => {
        setAuthRequired(true)
        setAuthenticated(false)
        setUser(null)
      })
      .finally(() => setLoading(false))

    return () => { window.fetch = originalFetch }
  }, [])

  // Login is a full browser navigation — we cannot do OIDC redirects via fetch.
  // returnTo preserves the page the user was on so the callback can drop them
  // back where they started.
  const login = () => {
    const returnTo = window.location.pathname + window.location.search
    window.location.href = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`
  }

  // Logout likewise — backend destroys session, then redirects through
  // Authentik's end_session endpoint if available, then back to '/'.
  const logout = () => {
    window.location.href = '/api/auth/logout'
  }

  return (
    <AuthContext.Provider value={{ loading, authRequired, authenticated, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
