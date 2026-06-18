import { Light, Device, DeviceStats } from '../types'

const API_URL = '/api'

// Same-origin fetches automatically include the session cookie; no per-call
// auth wrapping needed. The AuthContext-installed global fetch interceptor
// handles 401s by flipping the UI back to the login screen.
const authedFetch = (input: RequestInfo | URL, init: RequestInit = {}) =>
  fetch(input, { credentials: 'same-origin', ...init })

export const api = {
  // Lights
  async getLights(fast = false): Promise<Light[]> {
    const url = fast ? `${API_URL}/lights?fast=true` : `${API_URL}/lights`
    const response = await authedFetch(url)
    const data = await response.json()
    return data.lights || []
  },

  async controlLight(id: string, params: any): Promise<void> {
    const res = await authedFetch(`${API_URL}/lights/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    })
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}))
      const err = new Error('Light is enforced') as Error & { code: string; enforcedBy: any[]; lightId: string }
      err.code = 'ENFORCED'
      err.enforcedBy = body.enforcedBy || []
      err.lightId = body.lightId || id
      throw err
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Request failed (${res.status})`)
    }
  },

  async updateLight(id: string, updates: { name?: string; groups?: string[] }): Promise<void> {
    await authedFetch(`${API_URL}/lights/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    })
  },

  async getGroups(): Promise<any[]> {
    const res = await authedFetch(`${API_URL}/groups`)
    const data = await res.json()
    return data.groups
  },

  async createGroup(name: string, description: string, lights: string[], groups: string[] = []): Promise<any> {
    const res = await authedFetch(`${API_URL}/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, lights, groups })
    })
    const data = await res.json()
    return data.group
  },

  async updateGroup(groupId: string, updates: { name?: string; description?: string; lights?: string[]; groups?: string[] }): Promise<any> {
    const res = await authedFetch(`${API_URL}/groups/${groupId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    })
    const data = await res.json()
    return data.group
  },

  async deleteGroup(groupId: string): Promise<void> {
    await authedFetch(`${API_URL}/groups/${groupId}`, {
      method: 'DELETE'
    })
  },

  async controlGroup(groupId: string, params: any): Promise<any> {
    const res = await authedFetch(`${API_URL}/groups/${groupId}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    })
    return await res.json()
  },

  async updateGroupOrder(groupIds: string[]): Promise<void> {
    await authedFetch(`${API_URL}/groups/order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: groupIds })
    })
  },

  async updateLightOrder(lightIds: string[]): Promise<void> {
    await authedFetch(`${API_URL}/lights/order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: lightIds })
    })
  },

  // Automations / scenes
  async stopAutomation(id: string): Promise<void> {
    await authedFetch(`${API_URL}/automations/${id}/stop`, { method: 'POST' })
  },

  // Devices
  async getDiscoveredDevices(): Promise<Device[]> {
    const response = await authedFetch(`${API_URL}/devices/discovered`)
    const data = await response.json()
    return data.devices || []
  },

  async getConfiguredDevices(): Promise<Light[]> {
    const response = await authedFetch(`${API_URL}/devices/configured`)
    const data = await response.json()
    return data.devices || []
  },

  async getDeviceStats(): Promise<DeviceStats> {
    const response = await authedFetch(`${API_URL}/devices/stats`)
    return await response.json()
  },

  async addDevice(deviceId: string, name?: string): Promise<Device> {
    const response = await authedFetch(`${API_URL}/devices/discovered/${deviceId}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
    const data = await response.json()
    return data.device
  },

  async addAllDevices(): Promise<Device[]> {
    const response = await authedFetch(`${API_URL}/devices/discovered/add-all`, {
      method: 'POST'
    })
    const data = await response.json()
    return data.devices || []
  },

  async removeDevice(deviceId: string): Promise<void> {
    await authedFetch(`${API_URL}/devices/configured/${deviceId}`, {
      method: 'DELETE'
    })
  },

  async ignoreDevice(deviceId: string): Promise<void> {
    await authedFetch(`${API_URL}/devices/discovered/${deviceId}`, {
      method: 'DELETE'
    })
  },

  async scanNetwork(): Promise<Device[]> {
    const response = await authedFetch(`${API_URL}/devices/scan`, {
      method: 'POST'
    })
    const data = await response.json()
    return data.devices || []
  }
}
