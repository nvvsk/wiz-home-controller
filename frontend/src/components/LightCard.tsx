import { useState, useRef, useEffect } from 'react'
import { Lightbulb, Power, Edit2, Loader2, GripVertical } from 'lucide-react'
import { Light } from '../types'
import { api } from '../services/api'
import SignalStrength from './SignalStrength'

interface LightCardProps {
  light: Light
  onUpdate: () => void
  onEnforced?: (info: { lightName: string; enforcedBy: { id: string; name: string }[] }) => void
}

export default function LightCard({ light, onUpdate, onEnforced }: LightCardProps) {
  // Convert an enforce-error from the API into a callback up to the parent
  // (which owns the Toast / Stop-Enforce flow).
  const handleControlError = (err: any) => {
    if (err?.code === 'ENFORCED' && onEnforced) {
      onEnforced({ lightName: light.name, enforcedBy: err.enforcedBy || [] })
    } else if (err) {
      console.error('control failed:', err)
    }
  }
  const [loading, setLoading] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(light.name)
  const [localBrightness, setLocalBrightness] = useState(light.status?.brightness || 0)
  const [localTemp, setLocalTemp] = useState(light.status?.temperature || 3000)
  const brightnessTimeout = useRef<NodeJS.Timeout>()
  const tempTimeout = useRef<NodeJS.Timeout>()
  const [allGroups, setAllGroups] = useState<any[]>([])
  const [selectedGroups, setSelectedGroups] = useState<string[]>(light.groups || [])
  const [editingGroups, setEditingGroups] = useState(false)

  useEffect(() => {
    setLocalBrightness(light.status?.brightness || 0)
    setLocalTemp(light.status?.temperature || 3000)
  }, [light.status?.brightness, light.status?.temperature])

  useEffect(() => {
    setEditName(light.name)
  }, [light.name])

  useEffect(() => {
    setSelectedGroups(light.groups || [])
  }, [light.groups])

  useEffect(() => {
    const loadGroups = async () => {
      try {
        const groups = await api.getGroups()
        setAllGroups(groups)
      } catch (error) {
        console.error('Failed to load groups:', error)
      }
    }
    loadGroups()
  }, [])


  const hasStatus = light.status !== null && light.status !== undefined
  const hasValidStatus = hasStatus && (light.status?.state !== undefined || light.status?.brightness !== undefined)
  const isOn = light.status?.state || false
  const online = light.online !== false

  const handleToggle = async () => {
    setLoading(true)
    try {
      await api.controlLight(light.id, { state: !isOn })
      onUpdate()
    } catch (error) {
      handleControlError(error)
    } finally {
      setLoading(false)
    }
  }

  const handleBrightness = (value: number) => {
    setLocalBrightness(value)
    if (brightnessTimeout.current) clearTimeout(brightnessTimeout.current)
    brightnessTimeout.current = setTimeout(async () => {
      try {
        await api.controlLight(light.id, { brightness: value })
      } catch (error) {
        handleControlError(error)
      }
    }, 300)
  }

  const handleTemperature = (value: number) => {
    setLocalTemp(value)
    if (tempTimeout.current) clearTimeout(tempTimeout.current)
    tempTimeout.current = setTimeout(async () => {
      try {
        await api.controlLight(light.id, { temperature: value })
      } catch (error) {
        handleControlError(error)
      }
    }, 300)
  }

  const startEditing = () => {
    setEditName(light.name)
    setEditing(true)
  }

  const cancelEditing = () => {
    setEditName(light.name)
    setEditing(false)
  }

  const handleSaveGroups = async () => {
    try {
      await api.updateLight(light.id, { groups: selectedGroups })
      setEditingGroups(false)
      onUpdate()
    } catch (error) {
      console.error('Failed to update light groups:', error)
      alert('Failed to update light groups')
    }
  }

  const toggleGroup = (groupId: string) => {
    setSelectedGroups(prev => {
      const newGroups = prev.includes(groupId)
        ? prev.filter(id => id !== groupId)
        : [...prev, groupId]
      return newGroups
    })
  }

  const saveRename = async () => {
    if (!editName.trim() || editName.trim() === light.name) {
      setEditing(false)
      return
    }

    setRenaming(true)
    try {
      await api.updateLight(light.id, { name: editName.trim() })
      setEditing(false)
      onUpdate()
    } catch (error) {
      console.error('Failed to rename light:', error)
    } finally {
      setRenaming(false)
    }
  }

  // Loading state
  if (!hasValidStatus && online) {
    return (
      <div className="bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg border-2 border-gray-300 p-4 shimmer">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <Lightbulb className="w-6 h-6 text-gray-400 animate-pulse" />
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-semibold text-gray-700">{light.name}</h3>
                <button onClick={(e) => { e.stopPropagation(); startEditing(); }} className="text-gray-400 hover:text-gray-600">
                  <Edit2 className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-gray-500">{light.ip}</p>
            </div>
          </div>
          <div className="flex space-x-1">
            <div className="w-1 h-4 bg-blue-400 rounded animate-pulse" style={{ animationDelay: '0s' }} />
            <div className="w-1 h-4 bg-blue-400 rounded animate-pulse" style={{ animationDelay: '0.2s' }} />
            <div className="w-1 h-4 bg-blue-400 rounded animate-pulse" style={{ animationDelay: '0.4s' }} />
          </div>
        </div>
        
        <div className="space-y-3">
          <div className="flex items-center justify-center py-3 bg-gray-100 rounded-lg">
            <Loader2 className="w-5 h-5 text-gray-400 animate-spin mr-2" />
            <span className="text-sm text-gray-500">Connecting...</span>
          </div>
          <div className="space-y-2 opacity-40">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Brightness</span>
              <span className="text-xs text-gray-400">--</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full" />
          </div>
        </div>
      </div>
    )
  }

  // Offline state
  if (!online || !hasValidStatus) {
    return (
      <div className="bg-gray-100 rounded-lg border-2 border-gray-300 p-4 opacity-60">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <Lightbulb className="w-6 h-6 text-gray-400" />
            <div>
              <h3 className="font-semibold text-gray-700">{light.name}</h3>
              <p className="text-xs text-gray-500">{light.ip}</p>
            </div>
          </div>
          <span className="text-red-500 text-sm">⚠️ Offline</span>
        </div>
        <div className="text-center py-4 text-gray-500 text-sm">
          Light is not responding
        </div>
      </div>
    )
  }

  return (
    <div 
      className={`rounded-lg border-2 p-4 transition ${
        isOn ? 'bg-yellow-50 border-yellow-400' : 'bg-white border-gray-300'
      }`}
      onMouseDown={(e) => {
        // Check if mousedown is on an interactive element
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || 
            target.tagName === 'BUTTON' ||
            target.closest('input') ||
            target.closest('button')) {
          // Stop the event from reaching the parent draggable div
          e.stopPropagation()
        }
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <div 
            className="drag-handle cursor-move p-1 hover:bg-gray-200 rounded transition"
            draggable={true}
            title="Drag to reorder"
          >
            <GripVertical className="w-5 h-5 text-gray-400" />
          </div>
          <Lightbulb className={`w-6 h-6 ${isOn ? 'text-yellow-500' : 'text-gray-400'}`} />
          <div>
            <div className="flex items-center space-x-2">
              {editing ? (
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => { e.stopPropagation(); setEditName(e.target.value); }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') saveRename()
                      if (e.key === 'Escape') cancelEditing()
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    className="px-2 py-1 text-sm font-semibold border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                    disabled={renaming}
                  />
                  <button onClick={(e) => { e.stopPropagation(); saveRename(); }} disabled={renaming} className="text-green-600 hover:text-green-700 disabled:opacity-50">
                    {renaming ? <Loader2 className="w-4 h-4 animate-spin" /> : '✓'}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); cancelEditing(); }} disabled={renaming} className="text-red-600 hover:text-red-700 disabled:opacity-50">
                    ✕
                  </button>
                </div>
              ) : (
                <>
                  <h3 className="font-semibold text-gray-900">{light.name}</h3>
                  <button 
                    onClick={(e) => { e.stopPropagation(); startEditing(); }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
            <p className="text-xs text-gray-500">{light.ip}</p>
          </div>
        </div>
        <SignalStrength rssi={light.status?.rssi} />
      </div>

      <div className="space-y-3">
        <button
          onClick={(e) => { e.stopPropagation(); handleToggle(); }}
          disabled={loading}
          className={`w-full py-2 rounded-lg font-medium transition flex items-center justify-center ${
            isOn
              ? 'bg-yellow-500 text-white hover:bg-yellow-600'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          } disabled:opacity-50`}
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              <Power className="w-4 h-4 mr-2" />
              Turn {isOn ? 'Off' : 'On'}
            </>
          )}
        </button>

        <div 
          draggable={false}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onDragStart={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm text-gray-600">Brightness</label>
            <span className="text-sm font-medium text-gray-900">{localBrightness}%</span>
          </div>
          <input
            type="range"
            min="10"
            max="100"
            value={localBrightness}
            onChange={(e) => {
              e.stopPropagation()
              handleBrightness(parseInt(e.target.value))
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onDragStart={(e) => e.preventDefault()}
            disabled={loading}
            className="w-full accent-blue-500 cursor-pointer"
            style={{ pointerEvents: 'auto' }}
          />
        </div>

        <div 
          draggable={false}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onDragStart={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm text-gray-600">Temperature</label>
            <span className="text-sm font-medium text-gray-900">{localTemp}K</span>
          </div>
          <input
            type="range"
            min="3000"
            max="6500"
            value={localTemp}
            onChange={(e) => {
              e.stopPropagation()
              handleTemperature(parseInt(e.target.value))
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onDragStart={(e) => e.preventDefault()}
            disabled={loading}
            className="w-full temp-slider cursor-pointer"
            style={{ pointerEvents: 'auto' }}
          />
        </div>

        {/* Groups */}
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-gray-600">Groups</label>
            {editingGroups ? (
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setSelectedGroups(light.groups || [])
                    setEditingGroups(false)
                  }}
                  className="text-xs text-gray-600 hover:text-gray-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveGroups}
                  className="text-xs text-blue-600 hover:text-blue-700"
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditingGroups(true)}
                className="text-xs text-blue-600 hover:text-blue-700"
              >
                Edit
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {editingGroups ? (
              // Edit mode: show all groups
              <>
                {allGroups.map(group => (
                  <button
                    key={group.id}
                    onClick={() => toggleGroup(group.id)}
                    className={`px-2 py-1 text-xs rounded-full transition ${
                      selectedGroups.includes(group.id)
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {group.name}
                  </button>
                ))}
                {allGroups.length === 0 && (
                  <span className="text-xs text-gray-400">No groups available</span>
                )}
              </>
            ) : (
              // View mode: show only groups light is part of
              <>
                {(light.groups || []).length > 0 ? (
                  (light.groups || []).map(groupId => {
                    const group = allGroups.find(g => g.id === groupId)
                    if (!group) {
                      // Group ID exists but group not found in allGroups
                      return (
                        <span
                          key={groupId}
                          className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-full"
                        >
                          {groupId}
                        </span>
                      )
                    }
                    return (
                      <span
                        key={group.id}
                        className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full"
                      >
                        {group.name}
                      </span>
                    )
                  })
                ) : (
                  <span className="text-xs text-gray-400">No groups</span>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
