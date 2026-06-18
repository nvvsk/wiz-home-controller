import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Lightbulb, Settings, Users, Clock, Wand2, LogOut, User as UserIcon } from 'lucide-react'
import { useSocket } from '../services/socket'
import { useAuth } from '../contexts/AuthContext'

function initialsOf(label: string | null | undefined): string {
  if (!label) return '?'
  const parts = label.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function UserMenu() {
  const { authRequired, authenticated, user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on click outside.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (!authRequired || !authenticated || !user) return null

  const display = user.name || user.username || user.email || 'User'

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-100 transition"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="w-8 h-8 rounded-full bg-blue-500 text-white text-xs font-semibold flex items-center justify-center">
          {initialsOf(display)}
        </span>
        <span className="hidden md:inline text-sm text-gray-700 max-w-[10rem] truncate">{display}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <UserIcon className="w-4 h-4 text-gray-400" />
              <div className="text-sm font-medium text-gray-900 truncate">{display}</div>
            </div>
            {user.email && (
              <div className="text-xs text-gray-500 mt-1 truncate">{user.email}</div>
            )}
          </div>
          <button
            onClick={logout}
            role="menuitem"
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

export default function Header() {
  const location = useLocation()
  const { connected } = useSocket()

  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 sm:space-x-3">
            <Lightbulb className="w-6 h-6 sm:w-8 sm:h-8 text-yellow-500" />
            <h1 className="text-lg sm:text-2xl font-bold text-gray-900 hidden xs:block">WiZ Home Controller</h1>
            <h1 className="text-lg font-bold text-gray-900 xs:hidden">WiZ</h1>
          </div>

          <div className="flex items-center space-x-2 sm:space-x-4">
            <div className="hidden md:flex items-center space-x-2">
              {connected ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-sm text-gray-600">Connected</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 rounded-full bg-red-500"></div>
                  <span className="text-sm text-gray-600">Disconnected</span>
                </>
              )}
            </div>

            <nav className="flex space-x-1 sm:space-x-2">
              <Link
                to="/"
                className={`px-2 sm:px-4 py-2 rounded-lg transition ${
                  location.pathname === '/'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Lightbulb className="w-4 h-4 inline sm:mr-2" />
                <span className="hidden sm:inline">Dashboard</span>
              </Link>
              <Link
                to="/groups"
                className={`px-2 sm:px-4 py-2 rounded-lg transition ${
                  location.pathname === '/groups'
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Users className="w-4 h-4 inline sm:mr-2" />
                <span className="hidden sm:inline">Groups</span>
              </Link>
              <Link
                to="/scenes"
                className={`px-2 sm:px-4 py-2 rounded-lg transition ${
                  location.pathname === '/scenes'
                    ? 'bg-purple-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Wand2 className="w-4 h-4 inline sm:mr-2" />
                <span className="hidden sm:inline">Scenes</span>
              </Link>
              <Link
                to="/automations"
                className={`px-2 sm:px-4 py-2 rounded-lg transition ${
                  location.pathname === '/automations'
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Clock className="w-4 h-4 inline sm:mr-2" />
                <span className="hidden sm:inline">Automations</span>
              </Link>
              <Link
                to="/devices"
                className={`px-2 sm:px-4 py-2 rounded-lg transition ${
                  location.pathname === '/devices'
                    ? 'bg-purple-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Settings className="w-4 h-4 inline sm:mr-2" />
                <span className="hidden sm:inline">Devices</span>
              </Link>
            </nav>

            <UserMenu />
          </div>
        </div>
      </div>
    </header>
  )
}
