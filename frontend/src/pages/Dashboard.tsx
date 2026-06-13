import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Power, CheckSquare, X, Sun } from 'lucide-react'
import { Light, LightUpdate } from '../types'
import { api } from '../services/api'
import { useLightUpdates } from '../services/socket'
import Header from '../components/Header'
import LightCard from '../components/LightCard'
import Toast from '../components/Toast'

export default function Dashboard() {
  const [lights, setLights] = useState<Light[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [draggedLight, setDraggedLight] = useState<string | null>(null)
  const [dragOverLight, setDragOverLight] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning'; action?: { label: string; onClick: () => void } } | null>(null)
  const [controllingAll, setControllingAll] = useState(false)
  // Bulk mode — temporary multi-select for ad-hoc operations.
  const [bulkMode, setBulkMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBrightness, setBulkBrightness] = useState(80)
  const [bulkTemperature, setBulkTemperature] = useState(4000)
  const [applyingBulk, setApplyingBulk] = useState(false)

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ message, type })
  }

  // 409 from API → toast with a Stop button that releases the enforcing
  // automation(s) and reloads. If there are multiple enforcers, stop them all.
  const handleEnforced = (info: { lightName: string; enforcedBy: { id: string; name: string }[] }) => {
    const names = info.enforcedBy.map(e => e.name).join(', ') || 'an automation'
    setToast({
      message: `🔒 ${info.lightName} is locked by ${names}`,
      type: 'warning',
      action: info.enforcedBy.length > 0 ? {
        label: 'Stop enforce',
        onClick: async () => {
          await Promise.all(info.enforcedBy.map(e => fetch(`/api/automations/${e.id}/stop`, { method: 'POST' })))
          await loadLights(false)
          showToast(`Stopped ${info.enforcedBy.length} enforce${info.enforcedBy.length > 1 ? 's' : ''}`, 'success')
        }
      } : undefined
    })
  }

  const loadLights = useCallback(async (fast = false) => {
    try {
      const data = await api.getLights(fast)
      setLights(data)
      
      // Set timeout for offline detection (20s for weak signal lights)
      if (fast) {
        data.forEach(light => {
          if (!light.status) {
            setTimeout(() => {
              setLights(prev => prev.map(l => 
                l.id === light.id && !l.status ? { ...l, online: false } : l
              ))
            }, 20000)
          }
        })
      }
    } catch (error) {
      console.error('Failed to load lights:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadLights(true)
    // Note: syncPilot keep-alive is enabled by the server at startup —
    // no need to ask for it from the browser.
  }, [loadLights])

  const handleLightUpdate = useCallback((update: LightUpdate) => {
    setLights(prev => prev.map(light => {
      if (light.id === update.id || light.mac === update.mac) {
        if (update.status) {
          return { ...light, status: update.status, online: true }
        } else if (update.state !== undefined || update.brightness !== undefined || update.temperature !== undefined) {
          return {
            ...light,
            status: {
              state: update.state !== undefined ? update.state : (light.status?.state ?? false),
              brightness: update.brightness !== undefined ? update.brightness : (light.status?.brightness ?? 0),
              temperature: update.temperature !== undefined ? update.temperature : (light.status?.temperature ?? 3000),
              rgb: update.rgb ?? light.status?.rgb,
              rssi: update.rssi ?? light.status?.rssi,
              sceneId: light.status?.sceneId
            },
            online: true
          }
        }
        if (update.online === false) {
          return { ...light, online: false }
        }
      }
      return light
    }))
  }, [])

  useLightUpdates(handleLightUpdate)

  const handleDragStart = (e: React.DragEvent, lightId: string) => {
    setDraggedLight(lightId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, lightId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverLight(lightId)
  }

  const handleDragLeave = () => {
    setDragOverLight(null)
  }

  const handleDrop = async (e: React.DragEvent, targetLightId: string) => {
    e.preventDefault()
    
    if (!draggedLight || draggedLight === targetLightId) {
      setDraggedLight(null)
      setDragOverLight(null)
      return
    }

    // Reorder lights array
    const newLights = [...lights]
    const draggedIndex = newLights.findIndex(l => l.id === draggedLight)
    const targetIndex = newLights.findIndex(l => l.id === targetLightId)
    
    const [removed] = newLights.splice(draggedIndex, 1)
    newLights.splice(targetIndex, 0, removed)
    
    setLights(newLights)
    setDraggedLight(null)
    setDragOverLight(null)

    // Save order to backend
    try {
      await api.updateLightOrder(newLights.map(l => l.id))
    } catch (error) {
      console.error('Failed to save light order:', error)
      // Reload to get correct order
      await loadLights(true)
    }
  }

  const handleRefresh = async () => {
    setSyncing(true)
    await loadLights(false)
    setTimeout(() => setSyncing(false), 1000)
  }

  const handleAllLights = async (state: boolean) => {
    setControllingAll(true)
    try {
      // Control only online lights individually
      const onlineLights = lights.filter(light => light.online !== false)

      if (onlineLights.length === 0) {
        showToast('No online lights to control', 'warning')
        return
      }

      await Promise.all(
        onlineLights.map(light => api.controlLight(light.id, { state }))
      )
      await loadLights(false)
      showToast(`Turned ${state ? 'on' : 'off'} ${onlineLights.length} light${onlineLights.length > 1 ? 's' : ''}`, 'success')
    } catch (error) {
      console.error('Failed to control all lights:', error)
      showToast('Failed to control lights', 'error')
    } finally {
      setControllingAll(false)
    }
  }

  const toggleBulkMode = () => {
    setBulkMode(prev => !prev)
    setSelected(new Set())
  }

  const toggleSelected = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllOnline = () => {
    setSelected(new Set(lights.filter(l => l.online !== false).map(l => l.id)))
  }

  // Apply an arbitrary action to every selected light in parallel.
  // One slow/dead bulb doesn't block the others.
  const applyBulk = async (action: any, label: string) => {
    if (selected.size === 0) return
    setApplyingBulk(true)
    try {
      const ids = [...selected]
      const settled = await Promise.allSettled(ids.map(id => api.controlLight(id, action)))
      const failed = settled.filter(r => r.status === 'rejected').length
      const ok = ids.length - failed
      if (failed === 0) showToast(`${label} applied to ${ok} light${ok > 1 ? 's' : ''}`, 'success')
      else showToast(`${label} applied to ${ok}, ${failed} failed`, 'warning')
      await loadLights(false)
    } catch (err) {
      console.error('bulk apply failed', err)
      showToast('Bulk apply failed', 'error')
    } finally {
      setApplyingBulk(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 sm:mb-6 gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">My Lights</h2>
            <p className="text-sm text-gray-600">{lights.length} lights configured</p>
          </div>
          
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleAllLights(true)}
              disabled={controllingAll}
              className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition text-sm sm:text-base disabled:opacity-50"
            >
              <Power className={`w-4 h-4 inline mr-1 sm:mr-2 ${controllingAll ? 'animate-pulse' : ''}`} />
              All On
            </button>
            <button
              onClick={() => handleAllLights(false)}
              disabled={controllingAll}
              className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition text-sm sm:text-base disabled:opacity-50"
            >
              <Power className={`w-4 h-4 inline mr-1 sm:mr-2 ${controllingAll ? 'animate-pulse' : ''}`} />
              All Off
            </button>
            <button
              onClick={toggleBulkMode}
              className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 rounded-lg transition text-sm sm:text-base ${
                bulkMode ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
              }`}
            >
              <CheckSquare className="w-4 h-4 inline mr-1 sm:mr-2" />
              {bulkMode ? 'Exit Select' : 'Select'}
            </button>
            <button
              onClick={handleRefresh}
              disabled={syncing}
              className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition disabled:opacity-50 text-sm sm:text-base"
            >
              <RefreshCw className={`w-4 h-4 inline mr-1 sm:mr-2 ${syncing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Bulk-mode helper bar */}
        {bulkMode && (
          <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-purple-900">
              {selected.size === 0 ? 'Tap cards to select' : `${selected.size} selected`}
            </span>
            <div className="ml-auto flex gap-2">
              <button onClick={selectAllOnline} className="px-2 py-1 text-purple-700 hover:bg-purple-100 rounded">Select all online</button>
              <button onClick={() => setSelected(new Set())} disabled={selected.size === 0} className="px-2 py-1 text-purple-700 hover:bg-purple-100 rounded disabled:opacity-40">Clear</button>
            </div>
          </div>
        )}

        {lights.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No lights configured</p>
            <a href="/devices" className="text-blue-500 hover:underline mt-2 inline-block">
              Add lights in Device Management
            </a>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {lights.map(light => {
              const isSelected = selected.has(light.id)
              return (
                <div
                  key={light.id}
                  onDragStart={(e) => {
                    if (bulkMode) { e.preventDefault(); return }
                    const target = e.target as HTMLElement
                    const isDragHandle = target.closest('.drag-handle')
                    if (!isDragHandle) { e.preventDefault(); return }
                    if (window.matchMedia('(pointer: fine)').matches) {
                      handleDragStart(e, light.id)
                    }
                  }}
                  onDragOver={(e) => !bulkMode && handleDragOver(e, light.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => !bulkMode && handleDrop(e, light.id)}
                  onDragEnd={handleDragLeave}
                  className={`relative transition-all ${
                    dragOverLight === light.id ? 'scale-105 ring-2 ring-blue-500' : ''
                  } ${draggedLight === light.id ? 'opacity-50' : ''} ${
                    bulkMode && isSelected ? 'ring-2 ring-purple-500 rounded-lg' : ''
                  }`}
                >
                  <LightCard
                    light={light}
                    onUpdate={() => loadLights(false)}
                    onEnforced={handleEnforced}
                  />
                  {/* In bulk mode, an invisible layer captures clicks so the
                      whole card toggles selection and the inner controls
                      don't interfere. */}
                  {bulkMode && (
                    <button
                      onClick={() => toggleSelected(light.id)}
                      aria-label={isSelected ? 'Deselect' : 'Select'}
                      className="absolute inset-0 rounded-lg cursor-pointer"
                      style={{ background: isSelected ? 'rgba(168, 85, 247, 0.10)' : 'transparent' }}
                    >
                      <span className={`absolute top-3 right-3 w-7 h-7 rounded-full border-2 flex items-center justify-center ${
                        isSelected ? 'bg-purple-500 border-purple-500' : 'bg-white border-gray-300'
                      }`}>
                        {isSelected && <CheckSquare className="w-4 h-4 text-white" />}
                      </span>
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Floating action bar — shows when in bulk mode and ≥1 selected */}
        {bulkMode && selected.size > 0 && (
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-purple-200 shadow-lg z-40 p-3">
            <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-3">
              <div className="font-medium text-purple-900">{selected.size} selected</div>
              <button
                onClick={() => applyBulk({ state: true }, 'On')}
                disabled={applyingBulk}
                className="px-3 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 text-sm"
              >
                <Power className="w-4 h-4 inline mr-1" /> On
              </button>
              <button
                onClick={() => applyBulk({ state: false }, 'Off')}
                disabled={applyingBulk}
                className="px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 text-sm"
              >
                <Power className="w-4 h-4 inline mr-1" /> Off
              </button>
              <div className="flex items-center gap-2 ml-2">
                <Sun className="w-4 h-4 text-yellow-500" />
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={bulkBrightness}
                  onChange={e => setBulkBrightness(parseInt(e.target.value))}
                  className="w-24"
                />
                <span className="text-xs text-gray-700 w-10">{bulkBrightness}%</span>
                <button
                  onClick={() => applyBulk({ brightness: bulkBrightness }, `${bulkBrightness}%`)}
                  disabled={applyingBulk}
                  className="px-2 py-1 bg-yellow-500 text-white rounded text-sm disabled:opacity-50"
                >
                  Apply
                </button>
              </div>
              <div className="flex items-center gap-2 ml-2">
                <span className="text-xs text-gray-700">Temp</span>
                <input
                  type="range"
                  min={3000}
                  max={6500}
                  step={100}
                  value={bulkTemperature}
                  onChange={e => setBulkTemperature(parseInt(e.target.value))}
                  className="w-24"
                />
                <span className="text-xs text-gray-700 w-12">{bulkTemperature}K</span>
                <button
                  onClick={() => applyBulk({ temperature: bulkTemperature }, `${bulkTemperature}K`)}
                  disabled={applyingBulk}
                  className="px-2 py-1 bg-blue-500 text-white rounded text-sm disabled:opacity-50"
                >
                  Apply
                </button>
              </div>
              <button
                onClick={() => { setBulkMode(false); setSelected(new Set()) }}
                className="ml-auto p-2 text-gray-500 hover:text-gray-700"
                aria-label="Exit bulk mode"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </main>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          action={toast.action}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  )
}
