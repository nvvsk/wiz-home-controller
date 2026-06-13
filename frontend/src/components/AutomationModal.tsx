import { useState, useEffect, useRef } from 'react'
import { X, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'

interface AutomationModalProps {
  automation: any | null
  onSave: (automation: any) => void
  onClose: () => void
  groups: string[]
  lights: (string | { id: string; name: string })[]
  mode?: 'automation' | 'scene'
}

type ScheduleType = 'time' | 'sunrise' | 'sunset'

interface StepForm {
  // Targets — groups and lights are independent; users can pick any mix.
  selectedGroups: string[]
  selectedLights: string[]
  // Action toggles
  controlState: boolean
  controlBrightness: boolean
  controlTemperature: boolean
  state: boolean
  brightness: number
  temperature: number
  // Per-step transition
  useTransition: boolean
  transitionDuration: number
  // Per-step enforce
  enforce: boolean
  // UI: collapsed in the editor
  collapsed: boolean
}

function blankStep(): StepForm {
  return {
    selectedGroups: [],
    selectedLights: [],
    controlState: false,
    controlBrightness: false,
    controlTemperature: false,
    state: true,
    brightness: 100,
    temperature: 4000,
    useTransition: false,
    transitionDuration: 30,
    enforce: false,
    collapsed: false
  }
}

function parseTrigger(val: string | undefined): { type: ScheduleType; offset: number; time: string } {
  if (!val) return { type: 'time', offset: 0, time: '18:00' }
  if (/^\d{2}:\d{2}$/.test(val)) return { type: 'time', offset: 0, time: val }
  const m = val.match(/^(sunrise|sunset)([+-]\d+)?$/i)
  if (m) {
    return {
      type: m[1].toLowerCase() as ScheduleType,
      offset: m[2] ? parseInt(m[2]) : 0,
      time: '18:00'
    }
  }
  return { type: 'time', offset: 0, time: '18:00' }
}

function formatTrigger(type: ScheduleType, time: string, offset: number): string {
  if (type === 'time') return time
  if (offset === 0) return type
  return offset > 0 ? `${type}+${offset}` : `${type}${offset}`
}

// Snap transition duration to a reasonable set of values
const TRANSITION_STEPS = [1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]
function snapDuration(v: number): number {
  return TRANSITION_STEPS.reduce((prev, curr) => Math.abs(curr - v) < Math.abs(prev - v) ? curr : prev)
}

function stepFromBackend(s: any): StepForm {
  const action = s?.action || {}
  return {
    selectedGroups: s?.targets?.groups || [],
    selectedLights: s?.targets?.lights || [],
    controlState: action.state !== undefined,
    controlBrightness: action.brightness !== undefined,
    controlTemperature: action.temperature !== undefined,
    state: action.state ?? true,
    brightness: action.brightness ?? 100,
    temperature: action.temperature ?? 4000,
    useTransition: typeof s?.duration === 'number',
    transitionDuration: typeof s?.duration === 'number' ? s.duration : 30,
    enforce: !!s?.enforce,
    collapsed: false
  }
}

function legacyStep(automation: any): StepForm {
  const action = automation?.action || automation?.progression?.startState || {}
  return {
    selectedGroups: automation?.targets?.groups || [],
    selectedLights: automation?.targets?.lights || [],
    controlState: action.state !== undefined,
    controlBrightness: action.brightness !== undefined,
    controlTemperature: action.temperature !== undefined,
    state: action.state ?? true,
    brightness: action.brightness ?? 100,
    temperature: action.temperature ?? 4000,
    useTransition: !!automation?.schedule?.duration,
    transitionDuration: automation?.schedule?.duration || 30,
    enforce: !!automation?.enforce,
    collapsed: false
  }
}

export default function AutomationModal({ automation, onSave, onClose, groups, lights, mode = 'automation' }: AutomationModalProps) {
  const isScene = mode === 'scene'
  // Schedule fields are routine-level
  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [scheduleType, setScheduleType] = useState<ScheduleType>('sunset')
  const [time, setTime] = useState('18:00')
  const [offset, setOffset] = useState(0)

  // Routine-level end: only matters when any step has enforce (so enforce
  // knows when to release). Defaults to "none" for transition-only routines.
  const [hasRoutineEnd, setHasRoutineEnd] = useState(false)
  const [endType, setEndType] = useState<ScheduleType>('time')
  const [endTime, setEndTime] = useState('06:00')
  const [endOffset, setEndOffset] = useState(0)

  // Steps
  const [steps, setSteps] = useState<StepForm[]>([blankStep()])

  // Load existing automation
  useEffect(() => {
    if (!automation) {
      setSteps([blankStep()])
      return
    }
    const startParsed = parseTrigger(automation.schedule?.start)
    setName(automation.name || '')
    setEnabled(automation.enabled ?? true)
    setScheduleType(startParsed.type)
    setTime(startParsed.time)
    setOffset(startParsed.offset)

    const endVal = automation.schedule?.end
    if (endVal) {
      const endParsed = parseTrigger(endVal)
      setHasRoutineEnd(true)
      setEndType(endParsed.type)
      setEndTime(endParsed.time)
      setEndOffset(endParsed.offset)
    } else {
      setHasRoutineEnd(false)
    }

    if (Array.isArray(automation.steps) && automation.steps.length > 0) {
      setSteps(automation.steps.map(stepFromBackend))
    } else {
      setSteps([legacyStep(automation)])
    }
  }, [automation])

  const updateStep = (idx: number, patch: Partial<StepForm>) => {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s))
  }

  const addStep = () => setSteps(prev => [...prev.map(s => ({ ...s, collapsed: true })), blankStep()])
  const removeStep = (idx: number) => setSteps(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx))

  const anyEnforce = steps.some(s => s.enforce)
  const routineEndRef = useRef<HTMLDivElement | null>(null)

  // Routine-end picker only makes sense when at least one step is enforced.
  // Show/hide it strictly off `anyEnforce` so unchecking the last enforce
  // checkbox cleanly removes the picker (and vice-versa).
  useEffect(() => {
    setHasRoutineEnd(anyEnforce)
  }, [anyEnforce])

  // When the picker first appears, scroll it into view so the user doesn't
  // have to hunt for it after checking enforce on a far-down step.
  useEffect(() => {
    if (hasRoutineEnd && routineEndRef.current) {
      // Slight delay to let layout settle.
      setTimeout(() => routineEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
    }
  }, [hasRoutineEnd])

  const handleSave = () => {
    // Build steps (same shape for scenes and automations)
    const stepsPayload = steps.map(step => {
      // Include both arrays when present — backend deduplicates and resolves.
      const targets: any = {}
      if (step.selectedGroups.length > 0) targets.groups = step.selectedGroups
      if (step.selectedLights.length > 0) targets.lights = step.selectedLights

      const action: any = {}
      if (step.controlState) action.state = step.state
      if (step.controlBrightness) action.brightness = step.brightness
      if (step.controlTemperature) action.temperature = step.temperature

      const out: any = { targets, action }
      if (step.useTransition && step.controlBrightness) out.duration = step.transitionDuration
      // Scenes never enforce — they're one-shots.
      if (!isScene && step.enforce) out.enforce = true
      return out
    })

    const payload: any = {
      ...(automation?.id && { id: automation.id }),
      name,
      enabled,
      steps: stepsPayload
    }

    if (isScene) {
      payload.type = 'scene'
    } else {
      // Schedule + routine end only apply to scheduled automations.
      const start = formatTrigger(scheduleType, time, offset)
      const schedule: any = { start }
      if (hasRoutineEnd) schedule.end = formatTrigger(endType, endTime, endOffset)
      payload.schedule = schedule
    }

    onSave(payload)
  }

  // Step summary shown in collapsed header
  const stepSummary = (step: StepForm): string => {
    const bits: string[] = []
    if (step.controlState) bits.push(step.state ? 'ON' : 'OFF')
    if (step.controlBrightness) bits.push(`${step.brightness}%`)
    if (step.controlTemperature) bits.push(`${step.temperature}K`)
    if (step.useTransition && step.controlBrightness) bits.push(`${step.transitionDuration}m transition`)
    if (step.enforce) bits.push('enforce')
    const targetParts: string[] = []
    if (step.selectedGroups.length > 0) targetParts.push(`${step.selectedGroups.length} group${step.selectedGroups.length > 1 ? 's' : ''}`)
    if (step.selectedLights.length > 0) targetParts.push(`${step.selectedLights.length} light${step.selectedLights.length > 1 ? 's' : ''}`)
    if (targetParts.length === 0) targetParts.push('no targets')
    bits.push(targetParts.join(' + '))
    return bits.join(' • ')
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center z-10">
          <h2 className="text-xl font-semibold text-gray-900">
            {automation ? `Edit ${isScene ? 'Scene' : 'Automation'}` : `Create ${isScene ? 'Scene' : 'Automation'}`}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Automation Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., Evening Dimming"
            />
          </div>

          {/* Trigger — only for scheduled automations. Scenes are manual-only. */}
          {!isScene && (
          <div className="border-t pt-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">When to run</h3>
            <div className="space-y-4">
              <div className="flex gap-4">
                {(['time', 'sunrise', 'sunset'] as ScheduleType[]).map(t => (
                  <label key={t} className="flex items-center text-gray-700">
                    <input type="radio" checked={scheduleType === t} onChange={() => setScheduleType(t)} className="mr-2" />
                    {t === 'time' ? 'At Time' : t === 'sunrise' ? 'Sunrise' : 'Sunset'}
                  </label>
                ))}
              </div>

              {scheduleType === 'time' && (
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              )}

              {scheduleType !== 'time' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Offset (minutes)</label>
                  <div className="flex items-center gap-4">
                    <input
                      type="number"
                      value={offset}
                      onChange={(e) => setOffset(parseInt(e.target.value) || 0)}
                      className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      step="5"
                    />
                    <span className="text-sm text-gray-600">
                      {offset === 0 ? 'Exactly at' : offset > 0 ? 'minutes after' : 'minutes before'} {scheduleType}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
          )}

          {/* Steps */}
          <div className="border-t pt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                {steps.length === 1 ? 'Action' : `Steps (${steps.length})`}
              </h3>
              <button
                onClick={addStep}
                className="flex items-center space-x-1 px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded transition"
              >
                <Plus className="w-4 h-4" />
                <span>Add Step</span>
              </button>
            </div>

            <div className="space-y-4">
              {steps.map((step, idx) => (
                <div key={idx} className="border-2 border-gray-200 rounded-lg p-4">
                  {/* Step header */}
                  <div className="flex items-center justify-between mb-3">
                    <button
                      onClick={() => updateStep(idx, { collapsed: !step.collapsed })}
                      className="flex items-center space-x-2 text-left flex-1"
                    >
                      {step.collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      <span className="font-medium text-gray-900">Step {idx + 1}</span>
                      {step.collapsed && <span className="text-xs text-gray-500 ml-2 truncate">{stepSummary(step)}</span>}
                    </button>
                    {steps.length > 1 && (
                      <button
                        onClick={() => removeStep(idx)}
                        className="p-1 text-red-500 hover:bg-red-50 rounded transition"
                        title="Remove step"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {!step.collapsed && (
                    <div className="space-y-4">
                      {/* Targets — both groups and individual lights can be chosen
                          together. Backend resolves to a deduped light set. */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Target</label>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <div className="text-xs font-semibold text-gray-600 mb-1">
                              Groups {step.selectedGroups.length > 0 && <span className="text-blue-600">({step.selectedGroups.length})</span>}
                            </div>
                            <div className="space-y-1 max-h-32 overflow-y-auto border rounded p-2">
                              {groups.length === 0 ? (
                                <p className="text-gray-500 text-sm">No groups</p>
                              ) : (
                                groups.map(g => (
                                  <label key={g} className="flex items-center text-gray-700 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={step.selectedGroups.includes(g)}
                                      onChange={(e) => {
                                        const next = e.target.checked
                                          ? [...step.selectedGroups, g]
                                          : step.selectedGroups.filter(x => x !== g)
                                        updateStep(idx, { selectedGroups: next })
                                      }}
                                      className="mr-2"
                                    />
                                    {g}
                                  </label>
                                ))
                              )}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs font-semibold text-gray-600 mb-1">
                              Lights {step.selectedLights.length > 0 && <span className="text-blue-600">({step.selectedLights.length})</span>}
                            </div>
                            <div className="space-y-1 max-h-32 overflow-y-auto border rounded p-2">
                              {lights.length === 0 ? (
                                <p className="text-gray-500 text-sm">No lights</p>
                              ) : (
                                lights.map((light: any) => {
                                  const lightId = typeof light === 'string' ? light : (light.id || light.mac)
                                  const lightName = typeof light === 'string' ? light : (light.name || light.id || light.mac)
                                  return (
                                    <label key={lightId} className="flex items-center text-gray-700 text-sm">
                                      <input
                                        type="checkbox"
                                        checked={step.selectedLights.includes(lightId)}
                                        onChange={(e) => {
                                          const next = e.target.checked
                                            ? [...step.selectedLights, lightId]
                                            : step.selectedLights.filter(x => x !== lightId)
                                          updateStep(idx, { selectedLights: next })
                                        }}
                                        className="mr-2"
                                      />
                                      {lightName}
                                    </label>
                                  )
                                })
                              )}
                            </div>
                          </div>
                        </div>

                        {step.selectedGroups.length === 0 && step.selectedLights.length === 0 && (
                          <p className="mt-2 text-xs text-amber-600">Pick at least one group or light.</p>
                        )}
                      </div>

                      {/* Action: State */}
                      <div>
                        <label className="flex items-center text-gray-700 text-sm">
                          <input
                            type="checkbox"
                            checked={step.controlState}
                            onChange={(e) => updateStep(idx, { controlState: e.target.checked })}
                            className="mr-2"
                          />
                          <span className="font-medium">Power State</span>
                        </label>
                        {step.controlState && (
                          <div className="ml-6 mt-2 flex gap-4">
                            <label className="flex items-center text-gray-700 text-sm">
                              <input type="radio" checked={step.state === true} onChange={() => updateStep(idx, { state: true })} className="mr-2" />
                              ON
                            </label>
                            <label className="flex items-center text-gray-700 text-sm">
                              <input type="radio" checked={step.state === false} onChange={() => updateStep(idx, { state: false })} className="mr-2" />
                              OFF
                            </label>
                          </div>
                        )}
                      </div>

                      {/* Action: Brightness */}
                      <div>
                        <label className="flex items-center text-gray-700 text-sm">
                          <input
                            type="checkbox"
                            checked={step.controlBrightness}
                            onChange={(e) => updateStep(idx, { controlBrightness: e.target.checked })}
                            className="mr-2"
                          />
                          <span className="font-medium">Brightness</span>
                        </label>
                        {step.controlBrightness && (
                          <div className="ml-6 mt-2 space-y-3">
                            <div>
                              <label className="block text-sm text-gray-700 mb-1">{step.brightness}%</label>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                value={step.brightness}
                                onChange={(e) => updateStep(idx, { brightness: parseInt(e.target.value) })}
                                className="w-full"
                              />
                            </div>
                            <label className="flex items-center text-gray-700 text-sm">
                              <input
                                type="checkbox"
                                checked={step.useTransition}
                                onChange={(e) => updateStep(idx, { useTransition: e.target.checked, enforce: e.target.checked ? false : step.enforce })}
                                className="mr-2"
                              />
                              Transition over time
                            </label>
                            {step.useTransition && (
                              <div className="ml-6">
                                <label className="block text-sm text-gray-700 mb-1">
                                  {step.transitionDuration} min
                                </label>
                                <input
                                  type="range"
                                  min="1"
                                  max="60"
                                  step="1"
                                  value={step.transitionDuration}
                                  onChange={(e) => updateStep(idx, { transitionDuration: snapDuration(parseInt(e.target.value)) })}
                                  className="w-full"
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Action: Temperature */}
                      <div>
                        <label className="flex items-center text-gray-700 text-sm">
                          <input
                            type="checkbox"
                            checked={step.controlTemperature}
                            onChange={(e) => updateStep(idx, { controlTemperature: e.target.checked })}
                            className="mr-2"
                          />
                          <span className="font-medium">Color Temperature</span>
                        </label>
                        {step.controlTemperature && (
                          <div className="ml-6 mt-2">
                            <label className="block text-sm text-gray-700 mb-1">{step.temperature}K</label>
                            <input
                              type="range"
                              min="3000"
                              max="6500"
                              step="100"
                              value={step.temperature}
                              onChange={(e) => updateStep(idx, { temperature: parseInt(e.target.value) })}
                              className="w-full"
                            />
                          </div>
                        )}
                      </div>

                      {/* Per-step enforce — scenes don't have it. */}
                      {!isScene && (
                        <div>
                          <label className="flex items-center text-gray-700 text-sm">
                            <input
                              type="checkbox"
                              checked={step.enforce}
                              onChange={(e) => updateStep(idx, { enforce: e.target.checked, useTransition: e.target.checked ? false : step.useTransition })}
                              className="mr-2"
                            />
                            <span className="font-medium">Enforce</span>
                            <span className="ml-2 text-xs text-gray-500">Lock these settings until routine end</span>
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Routine end — auto-shown when ANY step is enforced; auto-hidden
              otherwise. Placed AFTER steps so checking enforce reveals the
              picker below where the user is looking, not above. */}
          {!isScene && hasRoutineEnd && (
            <div ref={routineEndRef} className="border-t pt-6">
              <h3 className="text-lg font-medium text-gray-900 mb-2">Routine ends at</h3>
              <p className="text-xs text-gray-500 mb-3">
                Enforce steps stay locked until this time.
              </p>
              <div className="flex gap-4 mb-3">
                {(['time', 'sunrise', 'sunset'] as ScheduleType[]).map(t => (
                  <label key={t} className="flex items-center text-gray-700 text-sm">
                    <input type="radio" checked={endType === t} onChange={() => setEndType(t)} className="mr-2" />
                    {t === 'time' ? 'At Time' : t === 'sunrise' ? 'Sunrise' : 'Sunset'}
                  </label>
                ))}
              </div>
              {endType === 'time' ? (
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              ) : (
                <div className="flex items-center gap-4">
                  <input
                    type="number"
                    value={endOffset}
                    onChange={(e) => setEndOffset(parseInt(e.target.value) || 0)}
                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    step="5"
                  />
                  <span className="text-sm text-gray-600">
                    {endOffset === 0 ? 'Exactly at' : endOffset > 0 ? 'minutes after' : 'minutes before'} {endType}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 px-6 py-4 flex justify-end gap-3 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {automation ? 'Update' : 'Create'} {isScene ? 'Scene' : 'Automation'}
          </button>
        </div>
      </div>
    </div>
  )
}
