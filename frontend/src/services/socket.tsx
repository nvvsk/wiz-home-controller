import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { io, Socket } from 'socket.io-client'
import { LightUpdate, Device } from '../types'

interface SocketContextType {
  socket: Socket | null
  connected: boolean
}

const SocketContext = createContext<SocketContextType>({ socket: null, connected: false })

export const useSocket = () => useContext(SocketContext)

export const SocketProvider = ({ children }: { children: ReactNode }) => {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    // No explicit auth in the handshake — the session cookie travels with
    // the websocket upgrade (and polling fallback) just like any HTTP request.
    // Server-side io.engine.use(sessionMiddleware) makes the session available
    // to the connection middleware.
    const newSocket = io({ withCredentials: true })

    newSocket.on('connect', () => setConnected(true))
    newSocket.on('disconnect', () => setConnected(false))
    newSocket.on('connect_error', (err) => {
      if (err.message === 'Unauthorized') {
        // Session is gone — reload so AuthProvider re-reads /api/auth/status
        // and renders the login screen.
        window.location.reload()
      }
    })

    setSocket(newSocket)
    return () => { newSocket.close() }
  }, [])

  return (
    <SocketContext.Provider value={{ socket, connected }}>
      {children}
    </SocketContext.Provider>
  )
}

export const useLightUpdates = (callback: (update: LightUpdate) => void) => {
  const { socket } = useSocket()

  useEffect(() => {
    if (!socket) return

    socket.on('light:update', callback)

    return () => {
      socket.off('light:update', callback)
    }
  }, [socket, callback])
}

export const useDeviceDiscovery = (callback: (device: Device) => void) => {
  const { socket } = useSocket()

  useEffect(() => {
    if (!socket) return

    socket.on('device:discovered', callback)

    return () => {
      socket.off('device:discovered', callback)
    }
  }, [socket, callback])
}

export const useDeviceAdded = (callback: (data: { device: any }) => void) => {
  const { socket } = useSocket()

  useEffect(() => {
    if (!socket) return

    socket.on('device:added', callback)

    return () => {
      socket.off('device:added', callback)
    }
  }, [socket, callback])
}

export const useDeviceRemoved = (callback: (data: { id: string }) => void) => {
  const { socket } = useSocket()

  useEffect(() => {
    if (!socket) return

    socket.on('device:removed', callback)

    return () => {
      socket.off('device:removed', callback)
    }
  }, [socket, callback])
}
