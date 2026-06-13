import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { io, Socket } from 'socket.io-client'
import { LightUpdate, Device } from '../types'
import { getAuthToken, notifyUnauthorized } from '../contexts/AuthContext'

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
    // Pass the auth token in the handshake. Server's io.use middleware
    // rejects unauthorized connections; we map that error to a logout.
    const newSocket = io({ auth: { token: getAuthToken() } })

    newSocket.on('connect', () => setConnected(true))
    newSocket.on('disconnect', () => setConnected(false))
    newSocket.on('connect_error', (err) => {
      if (err.message === 'Unauthorized') notifyUnauthorized()
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
