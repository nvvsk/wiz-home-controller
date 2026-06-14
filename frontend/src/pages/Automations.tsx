import { useState, useEffect } from 'react'
import { Clock, Plus, Edit2, Trash2, Power, Play, Square, Loader2, Sun, Calendar } from 'lucide-react'
import Header from '../components/Header'
import AutomationModal from '../components/AutomationModal'
import Toast from '../components/Toast'
import { useSocket } from '../services/socket'

interface AutomationStep {
  targets?: { lights?: string[]; groups?: string[] }
  action?: {
    state?: boolean
    brightness?: number
    temperature?: number
  }
  duration?: number
  enforce?: boolean
}

interface Automation {
  id: string
  name: string
  enabled: boolean
  schedule: {
    start: string
    end?: string
    duration?: number
    offset?: number
    days?: string[]
  }
  // Multi-step (new)
  steps?: AutomationStep[]
  // Legacy single-step (backward compat for older saved data)
  progression?: {
    type: string
    startState: any
    endState: any
  }
  action?: {
    state?: boolean
    brightness?: number
    temperature?: number
  }
  targets?: {
    lights?: string[]
    groups?: string[]
  }
  enforce?: boolean
  active?: boolean
}

// Coerce both legacy and new shapes into a steps[] array for rendering
function getSteps(a: Automation): AutomationStep[] {
  if (Array.isArray(a.steps) && a.steps.length > 0) return a.steps
  return [{
    targets: a.targets,
    action: a.action || (a.progression?.startState as any),
    duration: a.schedule?.duration,
    enforce: a.enforce
  }]
}

function describeStep(s: AutomationStep): string {
  const bits: string[] = []
  const action = s.action || {}
  if (action.state !== undefined) bits.push(action.state ? 'ON' : 'OFF')
  if (action.brightness !== undefined) bits.push(`${action.brightness}%`)
  if (action.temperature !== undefined) bits.push(`${action.temperature}K`)
  if (s.duration) bits.push(`${s.duration}m transition`)
  if (s.enforce) bits.push('enforced')
  const targetsStr = (s.targets?.groups || []).concat(s.targets?.lights || []).join(', ') || '?'
  return `${targetsStr} → ${bits.join(', ') || 'no change'}`
}

export default function Automations() {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null)
  const [groups, setGroups] = useState<string[]>([])
  const [lights, setLights] = useState<string[]>([])
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning'; action?: { label: string; onClick: () => void } } | null>(null)

  useEffect(() => {
    fetchAutomations()
    fetchGroupsAndLights()
  }, [])

  // Live updates: when the backend FSM flips an automation between
  // RUNNING and DONE we patch the `active` flag in-place. Avoids the
  // old pattern of fetching the whole list to learn one bit changed.
  const { socket } = useSocket()
  useEffect(() => {
    if (!socket) return
    const onStateChange = (data: { id: string; active: boolean }) => {
      setAutomations(prev => prev.map(a => a.id === data.id ? { ...a, active: data.active } : a))
    }
    // Edits don't auto-restart the routine — the in-memory event keeps the
    // old endTime/isManual flags. Tell the user to re-run so the new schedule
    // takes effect; offer a one-click action so they don't have to hunt.
    const onEditedWhileRunning = (data: { id: string; name: string }) => {
      setToast({
        message: `"${data.name}" is running with the previous schedule. Re-run to apply changes.`,
        type: 'warning',
        action: {
          label: 'Re-run',
          onClick: () => triggerAutomation(data.id)
        }
      })
    }
    socket.on('automation:state-change', onStateChange)
    socket.on('automation:edited-while-running', onEditedWhileRunning)
    return () => {
      socket.off('automation:state-change', onStateChange)
      socket.off('automation:edited-while-running', onEditedWhileRunning)
    }
  }, [socket])

  const fetchAutomations = async () => {
    try {
      const response = await fetch('/api/automations?type=automation')
      const data = await response.json()
      setAutomations(data)
    } catch (error) {
      console.error('Failed to fetch automations:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchGroupsAndLights = async () => {
    try {
      const [groupsRes, lightsRes] = await Promise.all([
        fetch('/api/groups'),
        fetch('/api/lights')
      ])
      
      console.log('Groups response status:', groupsRes.status)
      console.log('Lights response status:', lightsRes.status)
      
      const groupsData = await groupsRes.json()
      const lightsData = await lightsRes.json()
      
      console.log('Groups data:', groupsData)
      console.log('Lights data:', lightsData)
      
      // Handle groups - API returns { groups: [...] }
      const groupsList = Array.isArray(groupsData) ? groupsData : (groupsData.groups || [])
      const groupNames = groupsList.map((g: any) => g.id || g.name || g)
      console.log('Extracted groups:', groupNames)
      setGroups(groupNames)
      
      // Handle lights - API also returns { lights: [...] }
      const lightsList = Array.isArray(lightsData) ? lightsData : (lightsData.lights || [])
      // Store full light objects with id and name
      const lightsWithNames = lightsList.map((l: any) => ({
        id: l.id || l.mac || l,
        name: l.name || l.id || l.mac || l
      }))
      console.log('Extracted lights:', lightsWithNames)
      setLights(lightsWithNames)
    } catch (error) {
      console.error('Failed to fetch groups/lights:', error)
    }
  }

  const saveAutomation = async (automationData: any) => {
    try {
      const method = automationData.id ? 'PUT' : 'POST'
      const url = automationData.id 
        ? `/api/automations/${automationData.id}`
        : '/api/automations'
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(automationData)
      })
      
      const saved = await response.json()
      
      if (automationData.id) {
        setAutomations(automations.map(a => a.id === saved.id ? saved : a))
      } else {
        setAutomations([...automations, saved])
      }
      
      setShowModal(false)
      setEditingAutomation(null)
    } catch (error) {
      console.error('Failed to save automation:', error)
      alert('Failed to save automation')
    }
  }

  const toggleAutomation = async (id: string) => {
    try {
      const response = await fetch(`/api/automations/${id}/toggle`, {
        method: 'POST'
      })
      const updated = await response.json()
      setAutomations(automations.map(a => a.id === id ? updated : a))
    } catch (error) {
      console.error('Failed to toggle automation:', error)
    }
  }

  const triggerAutomation = async (id: string) => {
    try {
      await fetch(`/api/automations/${id}/trigger`, {
        method: 'POST'
      })
      // Reload automations to update UI (button change provides feedback)
      fetchAutomations()
    } catch (error) {
      console.error('Failed to trigger automation:', error)
      alert('Failed to start automation')
    }
  }

  const stopAutomation = async (id: string) => {
    try {
      await fetch(`/api/automations/${id}/stop`, {
        method: 'POST'
      })
      // Reload automations to update UI (button change provides feedback)
      fetchAutomations()
    } catch (error) {
      console.error('Failed to stop automation:', error)
      alert('Failed to stop automation')
    }
  }

  const deleteAutomation = async (id: string) => {
    if (!confirm('Are you sure you want to delete this automation?')) return
    
    try {
      await fetch(`/api/automations/${id}`, {
        method: 'DELETE'
      })
      setAutomations(automations.filter(a => a.id !== id))
    } catch (error) {
      console.error('Failed to delete automation:', error)
    }
  }

  const formatTime = (time: string) => {
    if (time.toLowerCase().includes('sunrise')) return `🌅 ${time}`
    if (time.toLowerCase().includes('sunset')) return `🌇 ${time}`
    return time
  }

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    if (hours > 0 && mins > 0) return `${hours}h ${mins}m`
    if (hours > 0) return `${hours}h`
    return `${mins}m`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {/* Page Header */}
          <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Automations</h1>
          <p className="text-gray-600 mt-1">Schedule and manage light automations</p>
        </div>
        <button
          onClick={() => {
            setEditingAutomation(null)
            setShowModal(true)
          }}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
        >
          <Plus className="w-5 h-5" />
          <span>New Automation</span>
        </button>
      </div>

      {/* Automations List */}
      {automations.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <Clock className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No automations yet</h3>
          <p className="text-gray-600 mb-4">Create your first automation to get started</p>
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
          >
            Create Automation
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {automations.map((automation) => (
            <div
              key={automation.id}
              className={`bg-white rounded-lg border-2 p-6 transition-all ${
                automation.active
                  ? 'border-green-500 shadow-lg'
                  : automation.enabled
                  ? 'border-gray-200'
                  : 'border-gray-200 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  {/* Name and Status */}
                  <div className="flex items-center space-x-3 mb-3">
                    <h3 className="text-xl font-semibold text-gray-900">{automation.name}</h3>
                    {automation.active && (
                      <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-full">
                        ACTIVE
                      </span>
                    )}
                    {!automation.enabled && (
                      <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs font-semibold rounded-full">
                        DISABLED
                      </span>
                    )}
                  </div>

                  {/* Schedule */}
                  <div className="flex items-center space-x-6 text-sm text-gray-600 mb-3">
                    <div className="flex items-center space-x-2">
                      <Clock className="w-4 h-4" />
                      <span>
                        {automation.schedule?.start && formatTime(automation.schedule.start)}
                        {automation.schedule?.end && ` → ${formatTime(automation.schedule.end)}`}
                        {automation.schedule?.duration && ` for ${formatDuration(automation.schedule.duration)}`}
                      </span>
                    </div>
                    {automation.schedule?.days && automation.schedule.days.length < 7 && (
                      <div className="flex items-center space-x-2">
                        <Calendar className="w-4 h-4" />
                        <span>{automation.schedule.days.join(', ')}</span>
                      </div>
                    )}
                  </div>

                  {/* Steps */}
                  {(() => {
                    const steps = getSteps(automation)
                    return (
                      <div className="space-y-1 text-sm">
                        {steps.length > 1 && (
                          <div className="text-xs text-gray-500 font-medium mb-1">
                            {steps.length} steps
                          </div>
                        )}
                        {steps.map((s, idx) => (
                          <div key={idx} className="flex items-start space-x-2">
                            <Sun className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                            <span className="text-gray-600">
                              {steps.length > 1 && <span className="text-gray-400 mr-1">{idx + 1}.</span>}
                              {describeStep(s)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>

                {/* Actions */}
                <div className="flex items-center space-x-2 ml-4">
                  {/* Show Play button only if enabled and not running */}
                  {automation.enabled && !automation.active && (
                    <button
                      onClick={() => triggerAutomation(automation.id)}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                      title="Run now"
                    >
                      <Play className="w-5 h-5" />
                    </button>
                  )}
                  {/* Show Stop button only if running */}
                  {automation.active && (
                    <button
                      onClick={() => stopAutomation(automation.id)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                      title="Stop"
                    >
                      <Square className="w-5 h-5" />
                    </button>
                  )}
                  <button
                    onClick={() => toggleAutomation(automation.id)}
                    className={`p-2 rounded-lg transition ${
                      automation.enabled
                        ? 'text-green-600 hover:bg-green-50'
                        : 'text-gray-400 hover:bg-gray-50'
                    }`}
                    title={automation.enabled ? 'Disable' : 'Enable'}
                  >
                    <Power className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => {
                      setEditingAutomation(automation)
                      setShowModal(true)
                    }}
                    className="p-2 text-gray-600 hover:bg-gray-50 rounded-lg transition"
                    title="Edit"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => deleteAutomation(automation.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                    title="Delete"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <AutomationModal
          automation={editingAutomation}
          onSave={saveAutomation}
          onClose={() => {
            setShowModal(false)
            setEditingAutomation(null)
          }}
          groups={groups}
          lights={lights}
        />
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
      </main>
    </div>
  )
}
