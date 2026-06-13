import { Link, useLocation } from 'react-router-dom'
import { Lightbulb, Settings, Users, Clock, Wand2 } from 'lucide-react'
import { useSocket } from '../services/socket'

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
          </div>
        </div>
      </div>
    </header>
  )
}
