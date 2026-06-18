import { Lightbulb, LogIn } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const { login } = useAuth()

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-lg shadow-md p-6 space-y-5">
        <div className="flex items-center space-x-2">
          <Lightbulb className="w-7 h-7 text-yellow-500" />
          <h1 className="text-xl font-bold text-gray-900">WiZ Home Controller</h1>
        </div>
        <p className="text-sm text-gray-600">Sign in with your Authentik account to continue.</p>

        <button
          type="button"
          onClick={login}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          <LogIn className="w-4 h-4" />
          Sign in with Authentik
        </button>
      </div>
    </div>
  )
}
