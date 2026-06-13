import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { SocketProvider } from './services/socket'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Dashboard from './pages/Dashboard'
import Devices from './pages/Devices'
import Groups from './pages/Groups'
import Automations from './pages/Automations'
import Scenes from './pages/Scenes'
import Login from './pages/Login'

function AuthedApp() {
  const { loading, authRequired, authenticated } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }
  if (authRequired && !authenticated) {
    return <Login />
  }
  return (
    <SocketProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/groups" element={<Groups />} />
          <Route path="/scenes" element={<Scenes />} />
          <Route path="/automations" element={<Automations />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SocketProvider>
  )
}

function App() {
  return (
    <AuthProvider>
      <AuthedApp />
    </AuthProvider>
  )
}

export default App
