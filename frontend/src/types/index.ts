export interface Light {
  id: string
  name: string
  ip: string
  mac: string
  groups: string[]
  status?: LightStatus
  online?: boolean
}

export interface LightStatus {
  state: boolean
  brightness: number
  temperature?: number
  rgb?: {
    r: number
    g: number
    b: number
  }
  rssi?: number
  sceneId?: number
}

export interface LightUpdate {
  id: string
  mac: string
  name: string
  state?: boolean
  brightness?: number
  temperature?: number
  rgb?: {
    r: number
    g: number
    b: number
  }
  rssi?: number
  online?: boolean
  status?: LightStatus
}

export interface Device {
  id: string
  ip: string
  mac: string
  modelConfig?: any
  discoveredAt: string
  source: string
  name?: string
  groups?: string[]
}

export interface DeviceStats {
  discovered: number
  configured: number
}
