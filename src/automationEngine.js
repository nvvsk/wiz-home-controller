const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const SunCalc = require('suncalc');
const logger = require('./logger');
const { safeWriteJsonSync } = require('./utils/safeWrite');

/**
 * AutomationEngine - Manages time-based automations with state progression
 * 
 * Features:
 * - Time-based state progression (e.g., brightness 10% → 100% over 1 hour)
 * - Server restart recovery (resume automations)
 * - Late-joiner catch-up (via StateProxy)
 */
class AutomationEngine extends EventEmitter {
  constructor(stateProxy, groupManager) {
    super();
    this.stateProxy = stateProxy;
    this.groupManager = groupManager;
    
    // Event-triggered automations
    this.eventListeners = new Map(); // eventType → Set<automationId>
    
    // FSM per automation: automationId → { state: 'RUNNING'|'DONE', timerId, endTime, isManual }
    // IDLE = not in runningEvents
    // RUNNING = in runningEvents, stepping brightness
    // DONE = removed from runningEvents (target reached or time expired)
    this.runningEvents = new Map();

    // Scheduler interval (15s) - detects IDLE→RUNNING transitions
    this.schedulerInterval = null;
    
    // Config
    this.configPath = path.join(__dirname, '../config/automations.json');
    this.locationPath = path.join(__dirname, '../config/location.json');
    this.automations = [];
    this.location = null;
    
    // Load location and automations
    this.loadLocation();
    this.loadAutomations();
    this.setupEventListeners();
    
    // Wire enforce check callbacks to StateProxy
    this.stateProxy.isLightEnforced = (lightId) => this.isLightEnforced(lightId);
    this.stateProxy.enforcersFor = (lightId) => this.enforcersFor(lightId);
  }
  
  /**
   * Load location config for sunrise/sunset calculations
   */
  loadLocation() {
    try {
      if (fs.existsSync(this.locationPath)) {
        const data = fs.readFileSync(this.locationPath, 'utf8');
        this.location = JSON.parse(data);
        logger.info(`AutomationEngine: Loaded location - ${this.location.city}`);
      } else {
        // Default to Bangalore
        this.location = {
          latitude: 12.9716,
          longitude: 77.5946,
          timezone: 'Asia/Kolkata',
          city: 'Bangalore'
        };
        logger.warn('AutomationEngine: No location config, using default (Bangalore)');
      }
    } catch (error) {
      logger.error('AutomationEngine: Failed to load location:', error.message);
      this.location = { latitude: 12.9716, longitude: 77.5946 };
    }
  }

  /**
   * Load automations from disk
   */
  loadAutomations() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        const config = JSON.parse(data);
        this.automations = config.automations || [];
        logger.info(`AutomationEngine: Loaded ${this.automations.length} automations`);
      } else {
        // Create empty config
        this.saveAutomations();
      }
    } catch (error) {
      logger.error('AutomationEngine: Failed to load automations:', error.message);
      this.automations = [];
    }
  }

  /**
   * Save automations to disk
   */
  saveAutomations() {
    try {
      const config = {
        automations: this.automations,
        lastSaved: new Date().toISOString()
      };
      safeWriteJsonSync(this.configPath, config);
      logger.verbose('AutomationEngine: Saved automations to disk');
    } catch (error) {
      logger.error('AutomationEngine: Failed to save automations:', error.message);
    }
  }

  /**
   * Create new automation
   */
  createAutomation(automation) {
    const newAutomation = {
      id: this.generateId(),
      ...automation,
      enabled: automation.enabled !== false,
      createdAt: new Date().toISOString()
    };
    
    this.automations.push(newAutomation);
    this.saveAutomations();
    
    logger.info(`AutomationEngine: Created automation "${newAutomation.name}"`);
    return newAutomation;
  }

  /**
   * Update automation
   */
  updateAutomation(id, updates) {
    const index = this.automations.findIndex(a => a.id === id);
    if (index === -1) {
      throw new Error(`Automation ${id} not found`);
    }

    // Editing the automation clears any active suspension — the new schedule
    // / steps should evaluate fresh.
    this.automations[index] = {
      ...this.automations[index],
      ...updates,
      releasedUntil: undefined,
      updatedAt: new Date().toISOString()
    };

    this.saveAutomations();
    
    logger.info(`AutomationEngine: Updated automation "${this.automations[index].name}"`);  
    return this.automations[index];
  }

  /**
   * Delete automation
   */
  deleteAutomation(id) {
    const index = this.automations.findIndex(a => a.id === id);
    if (index === -1) {
      throw new Error(`Automation ${id} not found`);
    }
    
    const automation = this.automations[index];
    this.automations.splice(index, 1);
    this.saveAutomations();
    
    logger.info(`AutomationEngine: Deleted automation "${automation.name}"`);
  }

  /**
   * Get all automations
   */
  getAllAutomations() {
    return this.automations.map(a => ({
      ...a,
      active: this.isAutomationRunning(a.id)
    }));
  }

  /**
   * Get automation by ID
   */
  getAutomation(id) {
    const automation = this.automations.find(a => a.id === id);
    if (!automation) return null;
    
    return {
      ...automation,
      active: this.isAutomationRunning(automation.id)
    };
  }

  /**
   * Check if a light is under any running enforce step.
   * Each running event carries its pre-resolved targets, so no per-call
   * group resolution is needed here.
   */
  isLightEnforced(lightId) {
    for (const event of this.runningEvents.values()) {
      if (!event.enforce || event.state !== 'RUNNING') continue;
      if (event.targets && event.targets.includes(lightId)) return true;
    }
    return false;
  }

  /**
   * Return the list of running automations whose enforce steps target this
   * light. Used by the 409 response so the UI can show "locked by X" and
   * offer a Stop button.
   */
  enforcersFor(lightId) {
    const ids = new Set();
    for (const event of this.runningEvents.values()) {
      if (!event.enforce || event.state !== 'RUNNING') continue;
      if (event.targets && event.targets.includes(lightId)) ids.add(event.automationId);
    }
    const out = [];
    for (const id of ids) {
      const a = this.automations.find(x => x.id === id);
      if (a) out.push({ id: a.id, name: a.name });
    }
    return out;
  }

  /**
   * Return an automation's steps in normalized form.
   *
   * Multi-step routines store actions in `automation.steps[]`. Legacy
   * single-step routines (and the original schema) keep `action` + `targets`
   * at the top level with `schedule.duration` for transitions and
   * `automation.enforce` for locked windows. We wrap the legacy form into a
   * one-element steps array so the rest of the engine only deals with steps.
   */
  normalizeSteps(automation) {
    if (Array.isArray(automation.steps) && automation.steps.length > 0) {
      return automation.steps.map(s => ({
        targets: s.targets || {},
        action: s.action || {},
        duration: typeof s.duration === 'number' ? s.duration : undefined,
        enforce: !!s.enforce
      }));
    }
    return [{
      targets: automation.targets || {},
      action: automation.action || {},
      duration: typeof automation.schedule?.duration === 'number' ? automation.schedule.duration : undefined,
      enforce: !!automation.enforce
    }];
  }

  /** Build the composite key used to track a step's running event. */
  stepKey(automationId, stepIdx) {
    return `${automationId}::${stepIdx}`;
  }

  /** True if any of this automation's steps is currently running. */
  isAutomationRunning(automationId) {
    const prefix = `${automationId}::`;
    for (const [key, event] of this.runningEvents) {
      if (key.startsWith(prefix) && event.state === 'RUNNING') return true;
    }
    return false;
  }

  /**
   * Setup event listeners for event-triggered automations
   */
  setupEventListeners() {
    // Clear existing listeners
    this.eventListeners.clear();
    
    // Register event-triggered automations
    for (const automation of this.automations) {
      if (automation.trigger && automation.trigger.type === 'event') {
        const eventType = automation.trigger.event;
        if (!this.eventListeners.has(eventType)) {
          this.eventListeners.set(eventType, new Set());
        }
        this.eventListeners.get(eventType).add(automation.id);
        logger.info(`AutomationEngine: Registered event listener for "${automation.name}" on "${eventType}"`);
      }
    }
  }

  /**
   * Handle an event (called externally when events occur)
   */
  handleEvent(eventType, eventData) {
    logger.info(`AutomationEngine: Event received - ${eventType}`, eventData);
    
    const automationIds = this.eventListeners.get(eventType);
    if (!automationIds || automationIds.size === 0) {
      return;
    }
    
    for (const automationId of automationIds) {
      const automation = this.automations.find(a => a.id === automationId);
      if (!automation || !automation.enabled) continue;
      
      // Check if event conditions match
      if (this.matchesEventConditions(automation, eventData)) {
        logger.info(`AutomationEngine: Event "${eventType}" triggered automation "${automation.name}"`);
        // Scheduler will handle the automation on next update
      }
    }
  }

  /**
   * Manually trigger an automation (on-demand execution).
   * Fires every step. If all steps complete instantly we still add a brief
   * "flash" event so the UI can show the user that the trigger landed.
   */
  triggerManually(automationId) {
    const automation = this.automations.find(a => a.id === automationId);
    if (!automation) throw new Error(`Automation not found: ${automationId}`);
    if (!automation.enabled) throw new Error(`Automation is disabled: ${automation.name}`);

    // Explicit user trigger overrides any active "release" suspension.
    if (automation.releasedUntil) {
      delete automation.releasedUntil;
      this.saveAutomations();
    }

    const steps = this.normalizeSteps(automation);
    logger.info(`AutomationEngine: Manually triggering "${automation.name}" (${steps.length} step${steps.length === 1 ? '' : 's'})`);

    if (this.isAutomationRunning(automationId)) {
      this.stopAutomation(automationId, 'restarted manually');
    }

    const routineEndTime = this.getRoutineEndTime(automation);
    this.startAutomationEvents(automation, routineEndTime, true);

    // If no step is still tracked (every step was instant), surface a brief
    // "flash" event so the Play→Stop transition is visible in the UI.
    if (!this.isAutomationRunning(automationId)) {
      const flashMs = 3000;
      const key = this.stepKey(automation.id, 'flash');
      const event = {
        state: 'RUNNING', timerId: null, endTime: Date.now() + flashMs,
        isManual: true, enforce: false,
        automationId: automation.id, stepIdx: 'flash',
        targets: [], action: {}
      };
      event.timerId = setTimeout(() => this.transitionStepToDone(automation.id, 'flash', 'flash complete'), flashMs);
      this.runningEvents.set(key, event);
      this.emit('automation:state-change', { id: automation.id, active: true });
    }

    return automation;
  }

  /**
   * Stop a running automation
   */
  stopManualTrigger(automationId) {
    const automation = this.automations.find(a => a.id === automationId);
    if (!automation) throw new Error(`Automation not found: ${automationId}`);
    
    this.stopAutomation(automationId, 'manually stopped');
    return automation;
  }

  /**
   * Check if event data matches automation conditions
   */
  matchesEventConditions(automation, eventData) {
    if (!automation.trigger || !automation.trigger.conditions) {
      return true; // No conditions = always match
    }
    
    const conditions = automation.trigger.conditions;
    
    // Check each condition
    for (const [key, value] of Object.entries(conditions)) {
      if (eventData[key] !== value) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Calculate sunrise/sunset times for today
   */
  getSunTimes(date = new Date()) {
    if (!this.location) return null;
    
    const times = SunCalc.getTimes(date, this.location.latitude, this.location.longitude);
    return {
      sunrise: times.sunrise,
      sunset: times.sunset,
      sunriseEnd: times.sunriseEnd,
      sunsetStart: times.sunsetStart,
      dawn: times.dawn,
      dusk: times.dusk,
      nauticalDawn: times.nauticalDawn,
      nauticalDusk: times.nauticalDusk,
      night: times.night,
      nightEnd: times.nightEnd,
      goldenHourEnd: times.goldenHourEnd,
      goldenHour: times.goldenHour
    };
  }

  /**
   * Resolve trigger-based time (sunrise/sunset) to actual time
   */
  resolveTime(timeString, date = new Date()) {
    // Check if it's a trigger-based time
    const triggerMatch = timeString.match(/^(sunrise|sunset)([+-]\d+)?$/i);
    
    if (triggerMatch) {
      const sunTimes = this.getSunTimes(date);
      if (!sunTimes) {
        logger.warn('AutomationEngine: No location configured for sunrise/sunset');
        return null;
      }
      
      const trigger = triggerMatch[1].toLowerCase();
      const offset = triggerMatch[2] ? parseInt(triggerMatch[2]) : 0; // minutes
      
      const baseTime = sunTimes[trigger];
      const resolvedTime = new Date(baseTime.getTime() + offset * 60000);
      
      return {
        hours: resolvedTime.getHours(),
        minutes: resolvedTime.getMinutes()
      };
    }
    
    // Regular HH:MM format
    const [hours, minutes] = timeString.split(':').map(Number);
    return { hours, minutes };
  }

  /**
   * Check if automation should be active now
   */
  shouldBeActive(automation) {
    if (!automation.enabled) return false;

    // Event-triggered automations are not time-based
    if (automation.trigger && automation.trigger.type === 'event') {
      return false; // Events are handled separately
    }

    // Released-until-next-scheduled-start: user pressed Stop, we paused this
    // cycle. Once the suspension timestamp passes, normal scheduling resumes.
    if (automation.releasedUntil && Date.now() < automation.releasedUntil) {
      return false;
    }
    
    const now = new Date();
    const currentDay = now.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase(); // mon, tue, etc.
    const currentTime = now.getHours() * 60 + now.getMinutes();
    
    // Check day of week
    if (automation.schedule.days && !automation.schedule.days.includes(currentDay)) {
      return false;
    }
    
    // Parse schedule times (support sunrise/sunset triggers and duration)
    const startResolved = this.resolveTime(automation.schedule.start, now);
    if (!startResolved) {
      logger.warn(`AutomationEngine: Could not resolve start time for "${automation.name}"`);
      return false;
    }
    
    const startTime = startResolved.hours * 60 + startResolved.minutes;
    let endTime;

    // Determine the routine's active window:
    //   1. schedule.end is preferred (sunrise, fixed time, etc.)
    //   2. otherwise use the longest step.duration (or schedule.duration for legacy)
    //   3. fallback 1 minute so instant routines still get a trigger window
    if (automation.schedule.end) {
      const endResolved = this.resolveTime(automation.schedule.end, now);
      if (!endResolved) {
        logger.warn(`AutomationEngine: Could not resolve end time for "${automation.name}"`);
        return false;
      }
      endTime = endResolved.hours * 60 + endResolved.minutes;
    } else {
      const steps = this.normalizeSteps(automation);
      const stepWindow = Math.max(0, ...steps.map(s => s.duration || 0));
      const legacyWindow = automation.schedule.duration || 0;
      const windowMin = Math.max(stepWindow, legacyWindow, 1);
      endTime = startTime + windowMin;
      if (endTime >= 1440) endTime = endTime - 1440;
    }
    
    // Handle overnight ranges (e.g., 22:00 - 06:00)
    if (endTime < startTime) {
      return currentTime >= startTime || currentTime <= endTime;
    }
    
    return currentTime >= startTime && currentTime <= endTime;
  }

  /**
   * Recover automations after server restart.
   *
   * Don't fire schedule checks immediately — pushManager has only just
   * registered lights, so actualStates is empty. The first transition tick
   * would read stale disk values instead of real bulb state. startScheduler()
   * applies its own delay (initialDelayMs) for the same reason.
   */
  async recoverFromRestart() {
    logger.info('AutomationEngine: Recovery scheduled — waiting for first light pushes');
  }

  /**
   * Resolve targets (lights + groups) to light IDs
   */
  resolveTargets(targets) {
    const lightIds = new Set();
    
    // Add direct lights
    if (targets.lights) {
      targets.lights.forEach(id => lightIds.add(id));
    }
    
    // Add lights from groups
    if (targets.groups) {
      targets.groups.forEach(groupId => {
        const groupLights = this.groupManager.getAllLightsInGroup(groupId);
        groupLights.forEach(id => lightIds.add(id));
      });
    }
    
    return Array.from(lightIds);
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return 'auto_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

  /**
   * Calculate end time for a routine's overall active window.
   * Step-level enforce events use this as their endTime when no per-step
   * cutoff is implied. Handles overnight wraps (23:30 → sunrise).
   */
  getRoutineEndTime(automation) {
    const now = new Date();
    const currentMs = now.getTime();
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const midnightMs = midnight.getTime();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    // Scenes (and any legacy entry without a schedule) have no time window.
    // Each step computes its own endTime from its own duration; return a
    // far-future fallback so callers never get an in-the-past value.
    if (!automation.schedule || !automation.schedule.start) {
      return currentMs + 60 * 60 * 1000; // +1 hour, arbitrary, not actually used
    }

    const startResolved = this.resolveTime(automation.schedule.start, now);
    if (!startResolved) return currentMs;
    let startMs = midnightMs + (startResolved.hours * 60 + startResolved.minutes) * 60 * 1000;
    if (startMs > currentMs) startMs -= ONE_DAY;

    if (automation.schedule.end) {
      const endResolved = this.resolveTime(automation.schedule.end, now);
      if (!endResolved) return currentMs;
      let endMs = midnightMs + (endResolved.hours * 60 + endResolved.minutes) * 60 * 1000;
      while (endMs <= startMs) endMs += ONE_DAY;
      return endMs;
    }

    // No explicit end → longest step.duration (or legacy schedule.duration),
    // minimum 1 minute so instant routines have a trigger window.
    const steps = this.normalizeSteps(automation);
    const stepWindow = Math.max(0, ...steps.map(s => s.duration || 0));
    const legacyWindow = automation.schedule.duration || 0;
    const windowMin = Math.max(stepWindow, legacyWindow, 1);
    return startMs + windowMin * 60 * 1000;
  }

  /**
   * Get the next brightness step toward target.
   * Steps in increments of 10 but honors arbitrary targets (e.g. 75 stays 75
   * rather than snapping to 80). Returns null when current is already at target.
   */
  getNextBrightness(current, target) {
    const cur = Math.round(current);
    const tgt = Math.round(target);
    if (cur === tgt) return null;
    const direction = tgt > cur ? 1 : -1;
    const next = cur + 10 * direction;
    // Final step is whatever lands exactly on target (may be < 10).
    return direction > 0 ? Math.min(next, tgt) : Math.max(next, tgt);
  }

  /**
   * FSM: IDLE → RUNNING
   * Spawns one event per step. Each step gets its own end time and FSM event:
   *   - enforce step → endTime = routineEndTime (locked for the whole window)
   *   - transition step (duration set) → endTime = now + duration
   *   - instant step → applied immediately, then transitions to DONE
   */
  startAutomationEvents(automation, routineEndTime, isManual = false) {
    if (this.isAutomationRunning(automation.id)) return;

    const steps = this.normalizeSteps(automation);
    const now = Date.now();
    const enforceSummary = steps.some(s => s.enforce) ? ', enforce' : '';
    logger.info(`AutomationEngine: "${automation.name}" IDLE→RUNNING (${steps.length} step${steps.length === 1 ? '' : 's'}, ${isManual ? 'manual' : 'scheduled'}${enforceSummary})`);

    // Emit state-change BEFORE we potentially complete instant steps, so the
    // UI sees the transition even if the routine is gone in 1ms.
    this.emit('automation:state-change', { id: automation.id, active: true });

    steps.forEach((step, idx) => {
      const targets = this.resolveTargets(step.targets);
      let endTime;
      if (step.enforce) {
        endTime = routineEndTime;
      } else if (step.duration) {
        endTime = now + step.duration * 60 * 1000;
      } else {
        endTime = now; // instant
      }

      const event = {
        state: 'RUNNING', timerId: null, endTime, isManual,
        enforce: step.enforce,
        automationId: automation.id, stepIdx: idx,
        targets, action: step.action, duration: step.duration
      };
      this.runningEvents.set(this.stepKey(automation.id, idx), event);

      // Enforce step: apply full state and stay RUNNING — drift is corrected by StateProxy.
      if (step.enforce) {
        for (const lightId of targets) {
          this.stateProxy.setDesiredState(lightId, step.action, 'automation');
        }
        logger.verbose(`AutomationEngine: step ${idx} enforcing ${targets.length} light(s) until ${new Date(endTime).toLocaleTimeString()}`);
        return;
      }

      // Non-brightness fields (state/temperature/rgb/sceneId) apply immediately.
      const immediateState = {};
      for (const k of ['state', 'temperature', 'r', 'g', 'b', 'sceneId']) {
        if (step.action[k] !== undefined) immediateState[k] = step.action[k];
      }
      if (Object.keys(immediateState).length > 0) {
        for (const lightId of targets) {
          this.stateProxy.setDesiredState(lightId, immediateState, 'automation');
        }
      }

      // Brightness handling
      if (step.action.brightness === undefined) {
        // Nothing to transition
        this.transitionStepToDone(automation.id, idx, 'no brightness transition');
        return;
      }
      if (!step.duration) {
        // Instant brightness
        for (const lightId of targets) {
          this.stateProxy.setDesiredState(lightId, {
            brightness: step.action.brightness,
            state: step.action.brightness > 0
          }, 'automation');
        }
        this.transitionStepToDone(automation.id, idx, 'instant brightness');
        return;
      }
      // Time-based brightness transition
      this.tick(automation.id, idx);
    });
  }

  /**
   * FSM: RUNNING tick for a single step.
   * Reads actual brightness, steps one increment toward target.
   */
  tick(automationId, stepIdx) {
    const key = this.stepKey(automationId, stepIdx);
    const event = this.runningEvents.get(key);
    if (!event || event.state !== 'RUNNING') return;

    const timeLeft = event.endTime - Date.now();
    if (timeLeft <= 0) {
      // Apply final target state and finish
      for (const lightId of event.targets) {
        this.stateProxy.setDesiredState(lightId, event.action, 'automation');
      }
      this.transitionStepToDone(automationId, stepIdx, 'time expired');
      return;
    }

    const targetBrightness = event.action.brightness;
    let anyChanged = false;
    let maxStepsLeft = 0;

    for (const lightId of event.targets) {
      const actual = this.stateProxy.actualStates.get(lightId);
      const desired = this.stateProxy.desiredStates.get(lightId);
      const currentBrightness = actual?.brightness ?? desired?.brightness ?? 0;

      const nextBrightness = this.getNextBrightness(currentBrightness, targetBrightness);
      if (nextBrightness === null) continue;

      anyChanged = true;
      const stepsLeft = Math.ceil(Math.abs(targetBrightness - currentBrightness) / 10);
      if (stepsLeft > maxStepsLeft) maxStepsLeft = stepsLeft;

      this.stateProxy.setDesiredState(lightId, {
        brightness: nextBrightness,
        state: nextBrightness > 0
      }, 'automation');
    }

    if (!anyChanged) {
      this.transitionStepToDone(automationId, stepIdx, 'target reached');
      return;
    }

    // Distribute remaining time across remaining steps (min 1s between ticks)
    const interval = Math.max(1000, timeLeft / Math.max(maxStepsLeft, 1));
    event.timerId = setTimeout(() => this.tick(automationId, stepIdx), interval);
  }

  /**
   * FSM: RUNNING → DONE for a single step.
   * Emits the routine-level 'active: false' only after the LAST step finishes.
   */
  transitionStepToDone(automationId, stepIdx, reason = 'stopped') {
    const key = this.stepKey(automationId, stepIdx);
    const event = this.runningEvents.get(key);
    if (!event) return;

    event.state = 'DONE';
    if (event.timerId) clearTimeout(event.timerId);
    this.runningEvents.delete(key);

    if (!this.isAutomationRunning(automationId)) {
      const automation = this.automations.find(a => a.id === automationId);
      logger.info(`AutomationEngine: "${automation?.name || automationId}" all steps DONE (${reason})`);
      this.emit('automation:state-change', { id: automationId, active: false });
    } else {
      logger.verbose(`AutomationEngine: ${automationId} step ${stepIdx} DONE (${reason})`);
    }
  }

  /**
   * Find the next moment after `now` when this automation's schedule says it
   * should start, considering days-of-week filtering. Used to compute
   * `releasedUntil` so a paused automation comes back at its next real cycle.
   */
  getNextScheduleStart(automation) {
    const now = new Date();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    for (let offset = 0; offset < 8; offset++) {
      const day = new Date(now.getTime() + offset * ONE_DAY);
      day.setHours(0, 0, 0, 0);
      // Skip days not in the allowed list
      if (automation.schedule?.days && automation.schedule.days.length > 0) {
        const dayName = day.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
        if (!automation.schedule.days.includes(dayName)) continue;
      }
      const resolved = this.resolveTime(automation.schedule.start, day);
      if (!resolved) continue;
      const startMs = day.getTime() + (resolved.hours * 60 + resolved.minutes) * 60 * 1000;
      if (startMs > now.getTime()) return startMs;
    }
    // Fallback if nothing found: 24h from now.
    return now.getTime() + ONE_DAY;
  }

  /**
   * Stop a running automation AND suspend it until its next scheduled start.
   * Without this suspension, the 15-second scheduler would immediately restart
   * the automation since the schedule window is still active.
   */
  releaseAutomation(automationId, reason = 'released') {
    const automation = this.automations.find(a => a.id === automationId);
    if (!automation) return;
    this.stopAutomation(automationId, reason);
    // Scenes have no schedule — nothing to suspend.
    if (automation.type !== 'scene' && automation.schedule?.start) {
      automation.releasedUntil = this.getNextScheduleStart(automation);
      this.saveAutomations();
      logger.info(`AutomationEngine: "${automation.name}" released until ${new Date(automation.releasedUntil).toLocaleString()}`);
    }
  }

  /**
   * Stop every running step belonging to this automation.
   */
  stopAutomation(automationId, reason = 'stopped') {
    const prefix = `${automationId}::`;
    const toStop = [];
    for (const key of this.runningEvents.keys()) {
      if (key.startsWith(prefix)) toStop.push(key);
    }
    if (toStop.length === 0) return;

    for (const key of toStop) {
      const event = this.runningEvents.get(key);
      if (event.timerId) clearTimeout(event.timerId);
      event.state = 'DONE';
      this.runningEvents.delete(key);
    }

    const automation = this.automations.find(a => a.id === automationId);
    logger.info(`AutomationEngine: "${automation?.name || automationId}" stopped (${reason}) — ${toStop.length} step${toStop.length === 1 ? '' : 's'} cleared`);
    this.emit('automation:state-change', { id: automationId, active: false });
  }

  /**
   * Check scheduled automations every 15s — starts/stops routines as needed.
   * For multi-step routines, "running" means any step has a live event.
   */
  checkAutomationSchedules() {
    for (const automation of this.automations) {
      if (!automation.enabled) continue;
      // Scenes are manual-only: they have no schedule and never auto-fire.
      if (automation.type === 'scene') continue;

      const shouldBeRunning = this.shouldBeActive(automation);
      const isRunning = this.isAutomationRunning(automation.id);

      if (shouldBeRunning && !isRunning) {
        const endTime = this.getRoutineEndTime(automation);
        this.startAutomationEvents(automation, endTime, false);
      } else if (!shouldBeRunning && isRunning) {
        // Enforce steps must honor the schedule's end even when manually
        // triggered — otherwise a tapped-Play enforce sits in RUNNING forever
        // (enforce steps have no self-timer; only the scheduler can close them).
        // Duration-based manual runs are still allowed to complete naturally.
        const prefix = `${automation.id}::`;
        let hasEnforce = false;
        let hasManual = false;
        for (const [key, event] of this.runningEvents) {
          if (!key.startsWith(prefix)) continue;
          if (event.enforce) hasEnforce = true;
          if (event.isManual) hasManual = true;
        }
        if (hasEnforce || !hasManual) {
          this.stopAutomation(automation.id, 'schedule ended');
        }
      }
    }
  }

  /**
   * Start scheduler - checks every 15s which automations should be running.
   *
   * `initialDelayMs` delays the FIRST check after server startup so that
   * pushManager has time to receive real status pushes (~5s for the first
   * heartbeat). Without this, the first transition tick after restart reads
   * stale disk-loaded brightness and starts from the wrong value.
   */
  startScheduler(initialDelayMs = 5000) {
    this.schedulerInterval = setInterval(() => {
      this.checkAutomationSchedules();
    }, 15000);

    setTimeout(() => this.checkAutomationSchedules(), initialDelayMs);
    logger.info(`AutomationEngine: Scheduler started (first check in ${initialDelayMs}ms, then every 15s)`);
  }

  /**
   * Stop scheduler and all running automation events
   */
  stopScheduler() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
    // Collect unique automation ids from step-keyed events ("id::idx")
    const ids = new Set();
    for (const key of this.runningEvents.keys()) {
      const sep = key.indexOf('::');
      ids.add(sep >= 0 ? key.slice(0, sep) : key);
    }
    for (const automationId of ids) {
      this.stopAutomation(automationId, 'server shutdown');
    }
    logger.info('AutomationEngine: Scheduler stopped');
  }
}

module.exports = AutomationEngine;
