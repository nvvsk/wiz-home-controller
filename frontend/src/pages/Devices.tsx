import { useState, useEffect, useCallback } from 'react'
import { Search, Plus, Trash2, CheckCircle, Loader2 } from 'lucide-react'
import { Device, Light, DeviceStats } from '../types'
import { api } from '../services/api'
import { useDeviceDiscovery, useDeviceAdded, useDeviceRemoved } from '../services/socket'
import Header from '../components/Header'
import Toast from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'

export default function Devices() {
  const [discoveredDevices, setDiscoveredDevices] = useState<Device[]>([])
  const [configuredDevices, setConfiguredDevices] = useState<Light[]>([])
  const [stats, setStats] = useState<DeviceStats>({ discovered: 0, configured: 0 })
  const [scanning, setScanning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [addingDevice, setAddingDevice] = useState<Device | null>(null)
  const [deviceName, setDeviceName] = useState('')
  const [adding, setAdding] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ message, type })
  }

  const loadData = useCallback(async () => {
    try {
      const [discovered, configured, deviceStats] = await Promise.all([
        api.getDiscoveredDevices(),
        api.getConfiguredDevices(),
        api.getDeviceStats()
      ])
      setDiscoveredDevices(discovered)
      setConfiguredDevices(configured)
      setStats(deviceStats)
    } catch (error) {
      console.error('Failed to load devices:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleDeviceDiscovered = useCallback((device: Device) => {
    setDiscoveredDevices(prev => {
      if (prev.some(d => d.id === device.id)) return prev
      return [...prev, device]
    })
    setStats(prev => ({ ...prev, discovered: prev.discovered + 1 }))
  }, [])

  const handleDeviceAdded = useCallback((data: any) => {
    console.log('Device added event received:', data)
    try {
      if (!data || !data.device) {
        console.error('Invalid device data:', data)
        return
      }
      
      // Remove from discovered list
      setDiscoveredDevices(prev => prev.filter(d => d.id !== data.device.id))
      // Add to configured list
      setConfiguredDevices(prev => [...prev, data.device])
      // Update stats
      setStats(prev => ({ 
        discovered: Math.max(0, prev.discovered - 1), 
        configured: prev.configured + 1 
      }))
    } catch (error) {
      console.error('Error handling device added:', error)
      // Fallback: reload all data
      loadData()
    }
  }, [loadData])

  const handleDeviceRemoved = useCallback((data: { id: string }) => {
    // Remove from configured list immediately
    setConfiguredDevices(prev => prev.filter(d => d.id !== data.id))
    setStats(prev => ({ ...prev, configured: prev.configured - 1 }))
  }, [])

  useDeviceDiscovery(handleDeviceDiscovered)
  useDeviceAdded(handleDeviceAdded)
  useDeviceRemoved(handleDeviceRemoved)

  const handleScan = async () => {
    setScanning(true)
    try {
      await api.scanNetwork()
      await loadData()
    } catch (error) {
      console.error('Scan failed:', error)
    } finally {
      setScanning(false)
    }
  }

  const handleAddDevice = (deviceId: string) => {
    const device = discoveredDevices.find(d => d.id === deviceId)
    if (device) {
      setAddingDevice(device)
      setDeviceName('')
    }
  }

  const confirmAddDevice = async () => {
    if (!addingDevice || adding) return

    setAdding(true)
    try {
      await api.addDevice(addingDevice.id, deviceName.trim() || undefined)
      // Reload data to ensure UI is updated
      await loadData()
      showToast(`Added ${deviceName.trim() || 'device'}`, 'success')
      setAddingDevice(null)
      setDeviceName('')
      setAdding(false)
    } catch (error) {
      console.error('Failed to add device:', error)
      showToast('Failed to add device: ' + (error as Error).message, 'error')
      setAdding(false)
    }
  }

  const handleAddAll = async () => {
    if (discoveredDevices.length === 0) {
      showToast('No devices to add', 'warning')
      return
    }

    if (!confirm(`Add all ${discoveredDevices.length} discovered devices?`)) {
      return
    }

    try {
      await api.addAllDevices()
      await loadData()
      showToast('Added all devices', 'success')
    } catch (error) {
      console.error('Failed to add all devices:', error)
      showToast('Failed to add all devices', 'error')
    }
  }

  const handleRemoveDevice = (deviceId: string, deviceName: string) => {
    setConfirmDelete({ id: deviceId, name: deviceName })
  }

  const confirmRemoveDevice = async () => {
    if (!confirmDelete) return
    
    try {
      await api.removeDevice(confirmDelete.id)
      await loadData()
      showToast(`Removed ${confirmDelete.name}`, 'success')
    } catch (error) {
      console.error('Failed to remove device:', error)
      showToast('Failed to remove device', 'error')
    } finally {
      setConfirmDelete(null)
    }
  }

  const handleIgnoreDevice = async (deviceId: string) => {
    try {
      await api.ignoreDevice(deviceId)
      await loadData()
    } catch (error) {
      console.error('Failed to ignore device:', error)
    }
  }

  const handleClearDiscovered = async () => {
    if (discoveredDevices.length === 0) {
      showToast('No devices to clear', 'warning')
      return
    }

    if (!confirm('Clear all discovered devices?')) {
      return
    }

    try {
      for (const device of discoveredDevices) {
        await api.ignoreDevice(device.id)
      }
      await loadData()
      showToast('Cleared all discovered devices', 'success')
    } catch (error) {
      console.error('Failed to clear devices:', error)
      showToast('Failed to clear devices', 'error')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Configured Devices</p>
                <p className="text-3xl font-bold text-gray-900">{stats.configured}</p>
              </div>
              <CheckCircle className="w-12 h-12 text-green-500" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Discovered Devices</p>
                <p className="text-3xl font-bold text-gray-900">{stats.discovered}</p>
              </div>
              <Search className="w-12 h-12 text-blue-500" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Devices</p>
                <p className="text-3xl font-bold text-gray-900">{stats.configured + stats.discovered}</p>
              </div>
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <span className="text-2xl">💡</span>
              </div>
            </div>
          </div>
        </div>

        {/* Discovered Devices */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">
              <Search className="w-5 h-5 inline text-blue-500 mr-2" />
              Discovered Devices
            </h2>
            <div className="flex space-x-2">
              <button
                onClick={handleScan}
                disabled={scanning}
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition disabled:opacity-50"
              >
                {scanning ? (
                  <Loader2 className="w-4 h-4 inline mr-2 animate-spin" />
                ) : (
                  <Search className="w-4 h-4 inline mr-2" />
                )}
                Scan Network
              </button>
              <button
                onClick={handleClearDiscovered}
                className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition"
              >
                <Trash2 className="w-4 h-4 inline mr-2" />
                Clear All
              </button>
              <button
                onClick={handleAddAll}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
              >
                <Plus className="w-4 h-4 inline mr-2" />
                Add All
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow overflow-hidden">
            {discoveredDevices.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <Search className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>No new devices discovered</p>
                <p className="text-sm mt-1">New WiZ lights will appear here automatically</p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Device</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">IP Address</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">MAC Address</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Discovered</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {discoveredDevices.map(device => (
                    <tr key={device.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <span className="text-2xl mr-3">💡</span>
                          <div>
                            <div className="text-sm font-medium text-gray-900">WiZ Light</div>
                            <div className="text-xs text-gray-500">{device.id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{device.ip}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500">{device.mac}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(device.discoveredAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => handleAddDevice(device.id)}
                          className="text-blue-600 hover:text-blue-900 mr-3"
                        >
                          <Plus className="w-4 h-4 inline mr-1" />
                          Add
                        </button>
                        <button
                          onClick={() => handleIgnoreDevice(device.id)}
                          className="text-gray-600 hover:text-gray-900"
                        >
                          <Trash2 className="w-4 h-4 inline mr-1" />
                          Ignore
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Configured Devices */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">
              <CheckCircle className="w-5 h-5 inline text-green-500 mr-2" />
              Configured Devices
            </h2>
          </div>

          <div className="bg-white rounded-lg shadow overflow-hidden">
            {configuredDevices.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <span className="text-4xl mb-3 block">💡</span>
                <p>No devices configured</p>
                <p className="text-sm mt-1">Add devices from the discovered list above</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Device</th>
                      <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">IP Address</th>
                      <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">MAC Address</th>
                      <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {configuredDevices.map(device => (
                      <tr key={device.id} className="hover:bg-gray-50">
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <span className="text-xl sm:text-2xl mr-2 sm:mr-3">💡</span>
                            <div className="min-w-0">
                              <div className="text-xs sm:text-sm font-medium text-gray-900 truncate">{device.name}</div>
                              <div className="text-xs text-gray-500 truncate">{device.id}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900">{device.ip}</td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm font-mono text-gray-500">{device.mac}</td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-right text-xs sm:text-sm font-medium">
                          <button
                            onClick={() => handleRemoveDevice(device.id, device.name)}
                            className="text-red-600 hover:text-red-900"
                          >
                            <Trash2 className="w-4 h-4 inline mr-1" />
                            <span className="hidden sm:inline">Remove</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Add Device Modal */}
      {addingDevice && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setAddingDevice(null)}>
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Add Device</h3>
            
            <div className="mb-4">
              <div className="flex items-center mb-3 p-3 bg-gray-50 rounded-lg">
                <span className="text-2xl mr-3">💡</span>
                <div>
                  <div className="text-sm font-medium text-gray-900">{addingDevice.ip}</div>
                  <div className="text-xs text-gray-500 font-mono">{addingDevice.mac}</div>
                </div>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Device Name
              </label>
              <input
                type="text"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder={`WiZ Light ${addingDevice.mac.slice(-4)}`}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmAddDevice()
                  if (e.key === 'Escape') setAddingDevice(null)
                }}
              />
              <p className="mt-1 text-xs text-gray-500">
                Leave empty to auto-name as "WiZ Light {addingDevice.mac.slice(-4)}"
              </p>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setAddingDevice(null)}
                disabled={adding}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={confirmAddDevice}
                disabled={adding}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {adding ? (
                  <>
                    <Loader2 className="w-4 h-4 inline mr-2 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 inline mr-2" />
                    Add Device
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Remove Device"
          message={`Are you sure you want to remove "${confirmDelete.name}"? This will remove it from your configuration.`}
          confirmText="Remove"
          cancelText="Cancel"
          type="danger"
          onConfirm={confirmRemoveDevice}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
