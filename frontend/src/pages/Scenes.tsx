import { useEffect, useState } from 'react'
import { Play, Plus, Edit2, Trash2, Loader2, Wand2 } from 'lucide-react'
import Header from '../components/Header'
import AutomationModal from '../components/AutomationModal'
import Toast from '../components/Toast'

interface Step {
  targets?: { groups?: string[]; lights?: string[] }
  action?: { state?: boolean; brightness?: number; temperature?: number }
  duration?: number
}

interface Scene {
  id: string
  name: string
  enabled: boolean
  type?: string
  steps?: Step[]
  // legacy single-step
  action?: any
  targets?: any
  active?: boolean
}

function getSteps(s: Scene): Step[] {
  if (Array.isArray(s.steps) && s.steps.length > 0) return s.steps
  return [{ targets: s.targets, action: s.action }]
}

function summarizeStep(s: Step): string {
  const bits: string[] = []
  const a = s.action || {}
  if (a.state !== undefined) bits.push(a.state ? 'ON' : 'OFF')
  if (a.brightness !== undefined) bits.push(`${a.brightness}%`)
  if (a.temperature !== undefined) bits.push(`${a.temperature}K`)
  if (s.duration) bits.push(`${s.duration}m transition`)
  const targets = (s.targets?.groups || []).concat(s.targets?.lights || []).join(', ') || '?'
  return `${targets} → ${bits.join(', ') || 'no change'}`
}

export default function Scenes() {
  const [scenes, setScenes] = useState<Scene[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingScene, setEditingScene] = useState<Scene | null>(null)
  const [groups, setGroups] = useState<string[]>([])
  const [lights, setLights] = useState<{ id: string; name: string }[]>([])
  const [running, setRunning] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const showToast = (message: string, type: 'success' | 'error') => setToast({ message, type })

  useEffect(() => {
    fetchAll()
  }, [])

  const fetchAll = async () => {
    try {
      const [scRes, gRes, lRes] = await Promise.all([
        fetch('/api/automations?type=scene'),
        fetch('/api/groups'),
        fetch('/api/lights?fast=true')
      ])
      setScenes(await scRes.json())
      const gData = await gRes.json()
      setGroups((gData.groups || []).map((g: any) => g.id))
      const lData = await lRes.json()
      setLights((lData.lights || []).map((l: any) => ({ id: l.id, name: l.name })))
    } catch (err) {
      console.error('Failed to load scenes:', err)
    } finally {
      setLoading(false)
    }
  }

  const saveScene = async (scene: any) => {
    try {
      const method = scene.id ? 'PUT' : 'POST'
      const url = scene.id ? `/api/automations/${scene.id}` : '/api/automations'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...scene, type: 'scene' })
      })
      if (!res.ok) {
        const err = await res.json()
        showToast(err.error || 'Failed to save', 'error')
        return
      }
      const saved = await res.json()
      if (scene.id) {
        setScenes(prev => prev.map(s => s.id === saved.id ? saved : s))
      } else {
        setScenes(prev => [...prev, saved])
      }
      setShowModal(false)
      setEditingScene(null)
      showToast('Saved', 'success')
    } catch (err) {
      console.error(err)
      showToast('Failed to save', 'error')
    }
  }

  const runScene = async (id: string, name: string) => {
    setRunning(id)
    try {
      await fetch(`/api/automations/${id}/trigger`, { method: 'POST' })
      showToast(`Running "${name}"`, 'success')
    } catch (err) {
      console.error(err)
      showToast('Failed to run scene', 'error')
    } finally {
      // Brief visual feedback even before the flash event clears
      setTimeout(() => setRunning(null), 500)
    }
  }

  const deleteScene = async (id: string) => {
    if (!confirm('Delete this scene?')) return
    await fetch(`/api/automations/${id}`, { method: 'DELETE' })
    setScenes(prev => prev.filter(s => s.id !== id))
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <Wand2 className="w-8 h-8 text-purple-500" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Scenes</h1>
              <p className="text-sm text-gray-600">One-tap presets to set the mood</p>
            </div>
          </div>
          <button
            onClick={() => { setEditingScene(null); setShowModal(true) }}
            className="flex items-center space-x-2 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition"
          >
            <Plus className="w-5 h-5" />
            <span>New Scene</span>
          </button>
        </div>

        {scenes.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-lg border-2 border-dashed border-gray-300">
            <Wand2 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No scenes yet</h3>
            <p className="text-gray-600 mb-4">Create scenes for moments like Movie, Bedtime, Welcome Home</p>
            <button
              onClick={() => { setEditingScene(null); setShowModal(true) }}
              className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition"
            >
              Create your first scene
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {scenes.map(scene => {
              const isRunning = running === scene.id || scene.active
              return (
                <div
                  key={scene.id}
                  className={`bg-white rounded-lg border-2 p-5 transition-all ${
                    isRunning ? 'border-purple-500 shadow-lg' : 'border-gray-200 hover:border-purple-300'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-lg font-semibold text-gray-900 truncate">{scene.name}</h3>
                    <div className="flex space-x-1">
                      <button
                        onClick={() => { setEditingScene(scene); setShowModal(true) }}
                        className="p-1 text-gray-400 hover:text-blue-500 transition"
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteScene(scene.id)}
                        className="p-1 text-gray-400 hover:text-red-500 transition"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1 mb-4 text-xs text-gray-600">
                    {getSteps(scene).map((s, idx) => (
                      <div key={idx} className="truncate">{summarizeStep(s)}</div>
                    ))}
                  </div>

                  <button
                    onClick={() => runScene(scene.id, scene.name)}
                    disabled={isRunning}
                    className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition disabled:opacity-50 disabled:cursor-wait"
                  >
                    {isRunning ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Play className="w-5 h-5" />
                    )}
                    <span className="font-medium">{isRunning ? 'Running…' : 'Run scene'}</span>
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {showModal && (
          <AutomationModal
            automation={editingScene}
            onSave={saveScene}
            onClose={() => { setShowModal(false); setEditingScene(null) }}
            groups={groups}
            lights={lights}
            mode="scene"
          />
        )}

        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </main>
    </div>
  )
}
