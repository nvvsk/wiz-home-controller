import { useState, useEffect, useCallback, useRef } from 'react'
import { Users, Plus, Edit2, Trash2, Lightbulb, Power, Loader2, GripVertical } from 'lucide-react'
import { api } from '../services/api'
import { useSocket } from '../services/socket'
import Header from '../components/Header'
import Toast from '../components/Toast'

interface Group {
  id: string
  name: string
  description: string
  lights: string[]
  groups: string[]
  lightCount: number
  totalLightCount: number
}

interface Light {
  id: string
  name: string
  ip: string
  mac: string
  status?: {
    state?: boolean
    brightness?: number
    temperature?: number
  }
  online?: boolean
}

export default function Groups() {
  const [groups, setGroups] = useState<Group[]>([])
  const [lights, setLights] = useState<Light[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [controlling, setControlling] = useState<string | null>(null)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [draggedGroup, setDraggedGroup] = useState<string | null>(null)
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null)
  const [draggedLight, setDraggedLight] = useState<string | null>(null)
  const [dragOverLight, setDragOverLight] = useState<string | null>(null)
  
  // Form state
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formLights, setFormLights] = useState<string[]>([])
  const [formGroups, setFormGroups] = useState<string[]>([])
  
  // Control state for each group
  const [groupBrightness, setGroupBrightness] = useState<Record<string, number>>({})
  const [groupTemperature, setGroupTemperature] = useState<Record<string, number>>({})
  const brightnessTimeouts = useRef<Record<string, NodeJS.Timeout>>({})
  const temperatureTimeouts = useRef<Record<string, NodeJS.Timeout>>({})
  // Per-slider last-interaction time. We pause auto-updates from the average
  // for a few seconds so the slider doesn't jump while the user is still
  // dragging or while the bulbs are mid-change.
  const lastUserTouchRef = useRef<Record<string, number>>({})
  const SLIDER_COOLDOWN_MS = 5000
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning'; action?: { label: string; onClick: () => void } } | null>(null)

  // Helper to get all lights in a group (including nested)
  const getAllLightsInGroup = (groupId: string, visited = new Set<string>()): string[] => {
    if (visited.has(groupId)) return []
    visited.add(groupId)
    
    const group = groups.find(g => g.id === groupId)
    if (!group) return []
    
    let allLights = [...group.lights]
    
    // Add lights from nested groups
    if (group.groups && group.groups.length > 0) {
      group.groups.forEach(nestedGroupId => {
        allLights = allLights.concat(getAllLightsInGroup(nestedGroupId, visited))
      })
    }
    
    // Remove duplicates
    return [...new Set(allLights)]
  }
  
  // Helper to count how many lights are ON in a group
  const getLightsOnCount = (groupId: string): number => {
    const lightIds = getAllLightsInGroup(groupId)
    return lightIds.filter(lightId => {
      const light = lights.find(l => l.id === lightId)
      return light && light.status?.state === true
    }).length
  }

  // Average a status field across currently-lit, online lights in a group.
  // Returns null when no lights qualify (group all-off or all-offline).
  const getGroupAverage = (groupId: string, field: 'brightness' | 'temperature'): number | null => {
    const lightIds = getAllLightsInGroup(groupId)
    const eligible = lightIds
      .map(id => lights.find(l => l.id === id))
      .filter(l => l && l.online !== false && l.status?.state === true && typeof l.status?.[field] === 'number')
    if (eligible.length === 0) return null
    const sum = eligible.reduce((s, l) => s + (l!.status![field] || 0), 0)
    return Math.round(sum / eligible.length)
  }
  
  // Helper to find parent groups (groups that contain this group)
  const getParentGroups = (groupId: string): Group[] => {
    return groups.filter(g => g.groups && g.groups.includes(groupId))
  }

  const loadData = useCallback(async () => {
    try {
      const [groupsData, lightsData] = await Promise.all([
        api.getGroups(),
        api.getLights(false) // Get full status to check which lights are ON
      ])
      setGroups(groupsData)
      setLights(lightsData)
      // Slider values come from getGroupAverage via the effect below — no
      // hardcoded defaults needed.
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Sync group sliders to the live average of their lights.
  // Runs whenever groups or lights change. Skips any slider that's been
  // touched in the last few seconds so a user's drag isn't yanked away.
  useEffect(() => {
    if (groups.length === 0) return
    const now = Date.now()
    setGroupBrightness(prev => {
      const next = { ...prev }
      let changed = false
      for (const g of groups) {
        if (now - (lastUserTouchRef.current[`${g.id}:b`] || 0) < SLIDER_COOLDOWN_MS) continue
        const avg = getGroupAverage(g.id, 'brightness')
        const target = avg ?? prev[g.id] ?? 80
        if (next[g.id] !== target) { next[g.id] = target; changed = true }
      }
      return changed ? next : prev
    })
    setGroupTemperature(prev => {
      const next = { ...prev }
      let changed = false
      for (const g of groups) {
        if (now - (lastUserTouchRef.current[`${g.id}:t`] || 0) < SLIDER_COOLDOWN_MS) continue
        const avg = getGroupAverage(g.id, 'temperature')
        const target = avg ?? prev[g.id] ?? 4000
        if (next[g.id] !== target) { next[g.id] = target; changed = true }
      }
      return changed ? next : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, lights])

  // Listen for light updates via WebSocket
  const { socket } = useSocket()
  
  useEffect(() => {
    if (!socket) return

    const handleLightUpdate = () => {
      // Reload lights to get updated status
      api.getLights(false).then(lightsData => {
        setLights(lightsData)
      }).catch(error => {
        console.error('Failed to reload lights:', error)
      })
    }

    socket.on('light:updated', handleLightUpdate)
    socket.on('light:status', handleLightUpdate)

    return () => {
      socket.off('light:updated', handleLightUpdate)
      socket.off('light:status', handleLightUpdate)
    }
  }, [socket])

  // Periodic polling to keep lights status fresh
  useEffect(() => {
    const interval = setInterval(() => {
      api.getLights(false).then(lightsData => {
        setLights(lightsData)
      }).catch(error => {
        console.error('Failed to refresh lights:', error)
      })
    }, 5000) // Refresh every 5 seconds

    return () => clearInterval(interval)
  }, [])

  const handleCreate = () => {
    setFormName('')
    setFormDescription('')
    setFormLights([])
    setFormGroups([])
    setCreating(true)
  }

  const handleEdit = (group: Group) => {
    setFormName(group.name)
    setFormDescription(group.description)
    setFormLights(group.lights)
    setFormGroups(group.groups || [])
    setEditing(group.id)
  }

  const handleSave = async () => {
    if (!formName.trim()) return

    try {
      if (editing) {
        await api.updateGroup(editing, {
          name: formName,
          description: formDescription,
          lights: formLights,
          groups: formGroups
        })
      } else {
        await api.createGroup(formName, formDescription, formLights, formGroups)
      }
      
      setCreating(false)
      setEditing(null)
      await loadData()
    } catch (error) {
      console.error('Failed to save group:', error)
      alert('Failed to save group: ' + (error as Error).message)
    }
  }

  const handleDelete = async (groupId: string) => {
    if (!confirm('Are you sure you want to delete this group?')) return

    try {
      await api.deleteGroup(groupId)
      await loadData()
    } catch (error) {
      console.error('Failed to delete group:', error)
      alert('Failed to delete group: ' + (error as Error).message)
    }
  }

  const handleControl = async (groupId: string, params: any) => {
    setControlling(groupId)
    try {
      const result = await api.controlGroup(groupId, params)
      const enforced = result.enforced || []
      if (enforced.length > 0) {
        // Aggregate the unique enforcing automations across all blocked lights.
        const enforcerMap = new Map<string, { id: string; name: string }>()
        for (const e of enforced) {
          for (const a of (e.enforcedBy || [])) enforcerMap.set(a.id, a)
        }
        const enforcers = [...enforcerMap.values()]
        setToast({
          message: `🔒 ${enforced.length} light${enforced.length > 1 ? 's' : ''} locked by ${enforcers.map(e => e.name).join(', ') || 'an automation'}`,
          type: 'warning',
          action: enforcers.length > 0 ? {
            label: 'Stop enforce',
            onClick: async () => {
              await Promise.all(enforcers.map(e => api.stopAutomation(e.id)))
              await handleControl(groupId, params) // retry
            }
          } : undefined
        })
      }
    } catch (error) {
      console.error('Failed to control group:', error)
      setToast({ message: 'Group control failed', type: 'error' })
    } finally {
      setControlling(null)
    }
  }

  const toggleLightInForm = (lightId: string) => {
    setFormLights(prev =>
      prev.includes(lightId)
        ? prev.filter(id => id !== lightId)
        : [...prev, lightId]
    )
  }

  const toggleGroupInForm = (groupId: string) => {
    setFormGroups(prev =>
      prev.includes(groupId)
        ? prev.filter(id => id !== groupId)
        : [...prev, groupId]
    )
  }

  const handleBrightnessChange = (groupId: string, value: number) => {
    lastUserTouchRef.current[`${groupId}:b`] = Date.now()
    setGroupBrightness(prev => ({ ...prev, [groupId]: value }))

    if (brightnessTimeouts.current[groupId]) {
      clearTimeout(brightnessTimeouts.current[groupId])
    }
    brightnessTimeouts.current[groupId] = setTimeout(() => {
      handleControl(groupId, { brightness: value })
    }, 300)
  }

  const handleTemperatureChange = (groupId: string, value: number) => {
    lastUserTouchRef.current[`${groupId}:t`] = Date.now()
    setGroupTemperature(prev => ({ ...prev, [groupId]: value }))

    if (temperatureTimeouts.current[groupId]) {
      clearTimeout(temperatureTimeouts.current[groupId])
    }
    temperatureTimeouts.current[groupId] = setTimeout(() => {
      handleControl(groupId, { temperature: value })
    }, 300)
  }

  const handleDragStart = (e: React.DragEvent, groupId: string) => {
    setDraggedGroup(groupId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, groupId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverGroup(groupId)
  }

  const handleDragLeave = () => {
    setDragOverGroup(null)
  }

  const handleDrop = async (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault()
    
    if (!draggedGroup || draggedGroup === targetGroupId) {
      setDraggedGroup(null)
      setDragOverGroup(null)
      return
    }

    // Reorder groups array
    const newGroups = [...groups]
    const draggedIndex = newGroups.findIndex(g => g.id === draggedGroup)
    const targetIndex = newGroups.findIndex(g => g.id === targetGroupId)
    
    const [removed] = newGroups.splice(draggedIndex, 1)
    newGroups.splice(targetIndex, 0, removed)
    
    setGroups(newGroups)
    setDraggedGroup(null)
    setDragOverGroup(null)

    // Save order to backend
    try {
      await api.updateGroupOrder(newGroups.map(g => g.id))
    } catch (error) {
      console.error('Failed to save group order:', error)
      // Reload to get correct order
      await loadData()
    }
  }

  const handleLightDragStart = (e: React.DragEvent, lightId: string) => {
    setDraggedLight(lightId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleLightDragOver = (e: React.DragEvent, lightId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverLight(lightId)
  }

  const handleLightDragLeave = () => {
    setDragOverLight(null)
  }

  const handleLightDrop = (e: React.DragEvent, targetLightId: string) => {
    e.preventDefault()
    
    if (!draggedLight || draggedLight === targetLightId) {
      setDraggedLight(null)
      setDragOverLight(null)
      return
    }

    // Reorder formLights array
    const newLights = [...formLights]
    const draggedIndex = newLights.indexOf(draggedLight)
    const targetIndex = newLights.indexOf(targetLightId)
    
    const [removed] = newLights.splice(draggedIndex, 1)
    newLights.splice(targetIndex, 0, removed)
    
    setFormLights(newLights)
    setDraggedLight(null)
    setDragOverLight(null)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <Users className="w-8 h-8 text-blue-500" />
            <h1 className="text-3xl font-bold text-gray-900">Groups</h1>
          </div>
          <button
            onClick={handleCreate}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
          >
            <Plus className="w-5 h-5" />
            <span>Create Group</span>
          </button>
        </div>

        {groups.length === 0 ? (
          <div className="text-center py-16">
            <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-600 mb-2">No groups yet</h3>
            <p className="text-gray-500 mb-6">Create a group to control multiple lights together</p>
            <button
              onClick={handleCreate}
              className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
            >
              Create Your First Group
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {groups.map(group => (
              <div 
                key={group.id} 
                onDragStart={(e) => {
                  const target = e.target as HTMLElement
                  const isDragHandle = target.closest('.drag-handle')
                  if (!isDragHandle) {
                    e.preventDefault()
                    return
                  }
                  handleDragStart(e, group.id)
                }}
                onDragOver={(e) => handleDragOver(e, group.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, group.id)}
                className={`bg-white rounded-lg border-2 p-6 transition-all ${
                  dragOverGroup === group.id ? 'border-blue-500 scale-105' : 'border-gray-200'
                } ${draggedGroup === group.id ? 'opacity-50' : ''}`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start space-x-2">
                    <div 
                      className="drag-handle cursor-move p-1 hover:bg-gray-200 rounded transition"
                      draggable={true}
                      title="Drag to reorder"
                    >
                      <GripVertical className="w-5 h-5 text-gray-400" />
                    </div>
                    <div>
                    <h3 className="text-lg font-semibold text-gray-900">{group.name}</h3>
                    {group.description && (
                      <p className="text-sm text-gray-500 mt-1">{group.description}</p>
                    )}
                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-gray-400">
                        {group.totalLightCount || group.lightCount} light{(group.totalLightCount || group.lightCount) !== 1 ? 's' : ''}
                        {group.groups && group.groups.length > 0 && ` (${group.groups.length} nested)`}
                      </p>
                      <p className="text-xs font-medium text-green-600">
                        {getLightsOnCount(group.id)} ON
                      </p>
                      {getParentGroups(group.id).length > 0 && (
                        <p className="text-xs text-blue-600">
                          Part of: {getParentGroups(group.id).map(g => g.name).join(', ')}
                        </p>
                      )}
                    </div>
                  </div>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleEdit(group)}
                      className="text-gray-400 hover:text-blue-500 transition"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(group.id)}
                      className="text-gray-400 hover:text-red-500 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleControl(group.id, { state: true })}
                      disabled={controlling === group.id}
                      className="flex-1 flex items-center justify-center space-x-2 px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition disabled:opacity-50"
                    >
                      {controlling === group.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Power className="w-4 h-4" />
                      )}
                      <span>On</span>
                    </button>
                    <button
                      onClick={() => handleControl(group.id, { state: false })}
                      disabled={controlling === group.id}
                      className="flex-1 flex items-center justify-center space-x-2 px-3 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition disabled:opacity-50"
                    >
                      <Power className="w-4 h-4" />
                      <span>Off</span>
                    </button>
                  </div>

                  <button
                    onClick={() => setExpandedGroup(expandedGroup === group.id ? null : group.id)}
                    className="w-full px-3 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition text-sm font-medium"
                  >
                    {expandedGroup === group.id ? '▼ Hide Controls' : '▶ Show Controls'}
                  </button>

                  {expandedGroup === group.id && (
                    <div className="space-y-3 pt-2 border-t border-gray-200">
                      {/* Brightness Control */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-sm font-medium text-gray-700">Brightness</label>
                          <span className="text-sm text-gray-600">{groupBrightness[group.id]}%</span>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="100"
                          value={groupBrightness[group.id] || 80}
                          onChange={(e) => handleBrightnessChange(group.id, parseInt(e.target.value))}
                          className="w-full accent-yellow-500 cursor-pointer"
                        />
                      </div>

                      {/* Temperature Control */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-sm font-medium text-gray-700">Temperature</label>
                          <span className="text-sm text-gray-600">{groupTemperature[group.id]}K</span>
                        </div>
                        <input
                          type="range"
                          min="3000"
                          max="6500"
                          value={groupTemperature[group.id] || 4000}
                          onChange={(e) => handleTemperatureChange(group.id, parseInt(e.target.value))}
                          className="w-full temp-slider cursor-pointer"
                        />
                        <div className="flex justify-between text-xs text-gray-500 mt-1">
                          <span>Warm (3000K)</span>
                          <span>Cool (6500K)</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create/Edit Modal */}
        {(creating || editing) && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => { setCreating(false); setEditing(null); }}>
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold mb-4">
                {editing ? 'Edit Group' : 'Create Group'}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    Group Name *
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g., Living Room"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    Description
                  </label>
                  <input
                    type="text"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Optional description"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    Select Lights
                  </label>
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-3">
                      {lights.filter(l => !formLights.includes(l.id)).map(light => (
                        <label
                          key={light.id}
                          className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={false}
                            onChange={() => toggleLightInForm(light.id)}
                            className="rounded"
                          />
                          <Lightbulb className="w-4 h-4 text-yellow-500" />
                          <span className="text-sm text-gray-900">{light.name}</span>
                        </label>
                      ))}
                    </div>
                    
                    {formLights.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-gray-700 mb-2">Selected (drag to reorder):</p>
                        <div className="space-y-1 max-h-48 overflow-y-auto border border-blue-200 rounded-lg p-2 bg-blue-50">
                          {formLights.map(lightId => {
                            const light = lights.find(l => l.id === lightId)
                            if (!light) return null
                            return (
                              <div
                                key={light.id}
                                draggable
                                onDragStart={(e) => handleLightDragStart(e, light.id)}
                                onDragOver={(e) => handleLightDragOver(e, light.id)}
                                onDragLeave={handleLightDragLeave}
                                onDrop={(e) => handleLightDrop(e, light.id)}
                                className={`flex items-center justify-between p-2 bg-white rounded transition-all ${
                                  dragOverLight === light.id ? 'border-2 border-blue-500 scale-105' : 'border border-gray-200'
                                } ${draggedLight === light.id ? 'opacity-50' : ''}`}
                              >
                                <div className="flex items-center space-x-2">
                                  <Lightbulb className="w-4 h-4 text-yellow-500" />
                                  <span className="text-sm text-gray-900">{light.name}</span>
                                </div>
                                <button
                                  onClick={() => toggleLightInForm(light.id)}
                                  className="text-red-500 hover:text-red-700"
                                >
                                  ✕
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {formLights.length} light{formLights.length !== 1 ? 's' : ''} selected
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    Nested Groups (Optional)
                  </label>
                  <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-3">
                    {groups.filter(g => g.id !== editing).map(group => (
                      <label
                        key={group.id}
                        className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={formGroups.includes(group.id)}
                          onChange={() => toggleGroupInForm(group.id)}
                          className="rounded"
                        />
                        <Users className="w-4 h-4 text-green-500" />
                        <span className="text-sm text-gray-900">{group.name}</span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {formGroups.length} group{formGroups.length !== 1 ? 's' : ''} selected
                  </p>
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => { setCreating(false); setEditing(null); }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!formName.trim()}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {editing ? 'Update Group' : 'Create Group'}
                </button>
              </div>
            </div>
          </div>
        )}

        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            action={toast.action}
            onClose={() => setToast(null)}
          />
        )}
      </div>
    </div>
  )
}
