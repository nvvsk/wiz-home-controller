import { useState, FormEvent } from 'react'
import { Lock, Lightbulb, Loader2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const { login, loginError } = useAuth()
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password) return
    setSubmitting(true)
    await login(password)
    setSubmitting(false)
    setPassword('')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white rounded-lg shadow-md p-6 space-y-5"
      >
        <div className="flex items-center space-x-2">
          <Lightbulb className="w-7 h-7 text-yellow-500" />
          <h1 className="text-xl font-bold text-gray-900">WiZ Home Controller</h1>
        </div>
        <p className="text-sm text-gray-600">Enter your password to continue.</p>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Password</span>
          <div className="mt-1 relative">
            <Lock className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="••••••••"
              disabled={submitting}
            />
          </div>
        </label>

        {loginError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            {loginError}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !password}
          className="w-full flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
        >
          {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
