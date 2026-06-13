const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const logger = require('./logger');
const { safeWriteJsonSync } = require('./utils/safeWrite');

/**
 * Thrown by setDesiredState when a non-automation source tries to change a
 * light that's currently under enforce. Carries the list of enforcing
 * automations so the UI can show "locked by X" and offer Stop.
 */
class EnforceError extends Error {
  constructor(lightId, enforcedBy) {
    super(`Light ${lightId} is enforced`);
    this.name = 'EnforceError';
    this.code = 'ENFORCED';
    this.lightId = lightId;
    this.enforcedBy = enforcedBy || [];
  }
}

/**
 * StateProxy - Tracks desired vs actual light states
 * 
 * Purpose:
 * - Track what state lights SHOULD be (desired)
 * - Track what state lights ACTUALLY are (actual)
 * - Reconcile differences (power restore, late-joiners)
 * - Persist state across server restarts
 */
class StateProxy extends EventEmitter {
  constructor(lightManager) {
    super();
    this.lightManager = lightManager;
    
    // In-memory state
    this.desiredStates = new Map(); // lightId → { state, brightness, temperature, source, lastUpdated, lastCommunication }
    this.actualStates = new Map();  // lightId → { state, brightness, temperature, lastCommunication }
    this.isLightEnforced = () => false; // callback set by AutomationEngine
    this.enforcersFor = () => [];       // callback set by AutomationEngine

    // When the process started. Used by isLightOnline() to be optimistic
    // during the first ~30s after a restart (heartbeats haven't flowed yet).
    this.startupTime = Date.now();

    // Config
    this.configPath = path.join(__dirname, '../config/state-proxy.json');
    this.saveDebounceTimeout = null;
    
    // Load persisted state
    this.loadFromDisk();
  }

  /**
   * Is this light reachable right now?
   *
   * - If we've received a syncPilot in the last 30s → online.
   * - During the first 30s after server startup (grace period) → assume
   *   online so the UI doesn't paint every card red while heartbeats
   *   are still arriving.
   * - Otherwise → offline (real evidence of silence).
   *
   * We deliberately read from actualStates, not desiredStates. desired
   * tracks user/automation INTENT and survives restarts; actual tracks
   * what we've actually heard from the bulb during this process.
   */
  isLightOnline(lightId) {
    const actual = this.actualStates.get(lightId);
    const now = Date.now();
    if (actual?.lastCommunication && (now - actual.lastCommunication) < 30000) {
      return true;
    }
    if (now - this.startupTime < 30000) return true;
    return false;
  }

  /**
   * Get all lights with their online status
   */
  getAllLightsStatus() {
    const status = {};
    for (const [lightId, desired] of this.desiredStates.entries()) {
      status[lightId] = {
        ...desired,
        online: this.isLightOnline(lightId)
      };
    }
    return status;
  }

  /**
   * Set desired state for a light.
   *
   * If the light is currently enforced by a running automation, only the
   * automation itself can change desiredState. User / external sources are
   * silently no-op'd — their command would otherwise wipe the enforce target
   * and cause statesMatch to incorrectly report agreement on the next push.
   * The user sees the light remain at the enforced state, which is the
   * whole point of enforce.
   */
  async setDesiredState(lightId, newState, source = 'user') {
    if (source !== 'automation' && this.isLightEnforced(lightId)) {
      const enforcers = this.enforcersFor(lightId);
      logger.info(`StateProxy: ${lightId} is enforced — rejecting ${source} command (locked by ${enforcers.map(e => e.name).join(', ') || 'unknown'})`);
      throw new EnforceError(lightId, enforcers);
    }

    const timestamp = Date.now();

    const existing = this.desiredStates.get(lightId);
    
    // If brightness is 0, set state to false
    const finalState = { ...newState };
    if (finalState.brightness === 0) {
      finalState.state = false;
    }
    
    // Enforce minimum temperature of 3000K
    if (finalState.temperature !== undefined && finalState.temperature < 3000) {
      finalState.temperature = 3000;
    }
    
    // Merge with existing desired state - partial updates preserve other fields
    const merged = {
      ...existing,
      ...finalState,
      source,
      lastUpdated: timestamp,
      lastCommunication: existing?.lastCommunication || null
    };

    // Clear conflicting color modes: RGB and temperature are mutually exclusive
    if (finalState.temperature !== undefined) {
      delete merged.r;
      delete merged.g;
      delete merged.b;
      delete merged.sceneId;
    }
    if (finalState.r !== undefined || finalState.g !== undefined || finalState.b !== undefined) {
      delete merged.temperature;
      delete merged.sceneId;
    }
    if (finalState.sceneId !== undefined) {
      delete merged.temperature;
      delete merged.r;
      delete merged.g;
      delete merged.b;
    }

    this.desiredStates.set(lightId, merged);
    
    // Persist to disk (debounced)
    this.saveToDisk();
    
    logger.verbose(`StateProxy: Updated desired state for ${lightId} (source: ${source})`);
    
    // Trigger immediate reconciliation for this light
    this.reconcileLight(lightId);
    
    return this.desiredStates.get(lightId);
  }

  /**
   * Get desired state for a light
   */
  getDesiredState(lightId) {
    return this.desiredStates.get(lightId);
  }

  /**
   * Reconcile a single light - send command if desired != actual
   */
  async reconcileLight(lightId) {
    const desired = this.desiredStates.get(lightId);
    const actual = this.actualStates.get(lightId);
    
    if (!desired) return;
    
    // If we don't have actual state yet, send command anyway
    if (!actual || !this.statesMatch(desired, actual)) {
      await this.sendCommandToLight(lightId, desired);
    }
  }

  /**
   * Send command to physical light
   */
  async sendCommandToLight(lightId, state) {
    try {
      const light = this.lightManager.lights.get(lightId);
      if (!light) {
        logger.warn(`StateProxy: Light ${lightId} not found`);
        return;
      }
      
      const lightName = light.name || lightId;
      
      // Strip metadata fields - only send hardware-relevant fields
      const command = {};
      if (state.state !== undefined) command.state = state.state;
      if (state.brightness !== undefined) command.brightness = state.brightness;
      if (state.temperature !== undefined) command.temperature = state.temperature;
      if (state.r !== undefined) command.r = state.r;
      if (state.g !== undefined) command.g = state.g;
      if (state.b !== undefined) command.b = state.b;
      if (state.sceneId !== undefined) command.sceneId = state.sceneId;
      state = command;
      
      // Turn light off
      if (state.state === false) {
        await light.controller.turnOff();
        this.actualStates.set(lightId, { ...state, timestamp: Date.now() });
        logger.info(`StateProxy: Sent OFF command to ${lightName}`);
        return;
      }
      
      // Set color (RGB or temperature) - these also turn the light on
      if (state.r !== undefined && state.g !== undefined && state.b !== undefined) {
        await light.controller.setRGB(state.r, state.g, state.b, state.brightness);
      } else if (state.temperature !== undefined) {
        await light.controller.setColorTemp(state.temperature, state.brightness);
      } else if (state.brightness !== undefined) {
        await light.controller.setBrightness(state.brightness);
      } else if (state.state === true) {
        // Only send turnOn if no brightness/color/temp to set
        await light.controller.turnOn();
      }
      
      // Update actual state on success
      this.actualStates.set(lightId, {
        ...state,
        timestamp: Date.now()
      });
      
      logger.info(`StateProxy: Sent command to ${lightName} - ${JSON.stringify(command)}`);
      
    } catch (error) {
      logger.warn(`StateProxy: Failed to send command to ${lightId}: ${error.message}`);
    }
  }

  /**
   * Get actual state for a light
   */
  getActualState(lightId) {
    return this.actualStates.get(lightId);
  }

  /**
   * Called when light sends status update (via pushManager)
   */
  onLightStatusUpdate(lightId, actualStatus) {
    const now = Date.now();
    const wasOffline = !this.isLightOnline(lightId); // no push in >30s = was offline (reboot)
    
    // Update actual state
    this.actualStates.set(lightId, {
      state: actualStatus.state,
      brightness: actualStatus.brightness,
      temperature: actualStatus.temperature,
      rssi: actualStatus.rssi,
      lastCommunication: now
    });
    
    // Get desired state
    const desired = this.desiredStates.get(lightId);
    
    if (!desired) {
      // No desired state yet, use actual as desired
      this.desiredStates.set(lightId, {
        state: actualStatus.state,
        brightness: actualStatus.brightness,
        temperature: actualStatus.temperature,
        source: 'init',
        lastUpdated: now,
        lastCommunication: now
      });
      this.saveToDisk();
      return;
    }
    
    // Update lastCommunication in desired state
    desired.lastCommunication = now;
    this.saveToDisk();
    
    // Compare desired vs actual
    if (!this.statesMatch(desired, actualStatus)) {
      const light = this.lightManager.lights.get(lightId);
      const lightName = light ? light.name : lightId;

      if (this.isLightEnforced(lightId)) {
        // Any drift on an enforced light → revert to desired. Covers both
        // reboot recovery (wasOffline=true) AND live external changes via
        // WiZ app, physical switch, or rogue API caller.
        logger.info(`StateProxy: ${lightName} enforced drift detected (${wasOffline ? 'after reboot' : 'live external change'}) — reverting`);
        this.reconcileLight(lightId);
      } else {
        // Non-enforced light: external change wins → adopt as new desired
        logger.info(`StateProxy: ${lightName} external change accepted as new desired`);
        this.desiredStates.set(lightId, {
          ...desired,
          state: actualStatus.state,
          brightness: actualStatus.brightness,
          temperature: actualStatus.temperature,
          source: 'external',
          lastUpdated: now,
          lastCommunication: now
        });
        this.saveToDisk();
      }
    }
  }

  /**
   * Called when light comes online - reconcile after first push received
   */
  async onLightOnline(lightId) {
    const desired = this.desiredStates.get(lightId);
    if (!desired) return;

    setTimeout(async () => {
      const actual = this.actualStates.get(lightId);
      if (!actual) return;

      if (!this.statesMatch(desired, actual)) {
        const light = this.lightManager.lights.get(lightId);
        logger.info(`StateProxy: Late-joiner ${light?.name || lightId} - reconciling`);
        await this.reconcileLight(lightId);
      }
    }, 6000);
  }

  /**
   * Check if two states match (only compares fields that exist in state1)
   */
  statesMatch(state1, state2) {
    if (!state1 || !state2) return false;
    
    // If both are off, they match (brightness/temp don't matter when off)
    if (state1.state === false && state2.state === false) {
      return true;
    }
    
    // Only compare state if it's explicitly defined in desired (state1)
    if (state1.state !== undefined && state1.state !== state2.state) {
      return false;
    }
    
    // Both are on - check only the fields that are defined in state1
    if (state1.brightness !== undefined) {
      const brightnessDiff = Math.abs(state1.brightness - (state2.brightness || 0));
      if (brightnessDiff > 5) return false; // Allow 5% tolerance
    }
    
    if (state1.temperature !== undefined) {
      const tempDiff = Math.abs(state1.temperature - (state2.temperature || 0));
      if (tempDiff > 100) return false; // Allow 100K tolerance
    }
    
    return true;
  }

  /**
   * Initialize proxy with current light states
   */
  async initialize() {
    const lights = this.lightManager.getAllLights();
    
    for (const light of lights) {
      if (!this.desiredStates.has(light.id) && light.status) {
        // Initialize with current state
        this.desiredStates.set(light.id, {
          state: light.status.state || false,
          brightness: light.status.brightness || 10,
          temperature: light.status.temperature || 3000,
          source: 'init',
          timestamp: Date.now()
        });
      }
    }
    
    this.saveToDisk();
    logger.info(`StateProxy: Initialized with ${lights.length} lights`);
  }

  /**
   * Load state from disk.
   *
   * Preserve the original source and lastUpdated so the audit trail
   * survives restarts (otherwise the file would lie about who last
   * changed each light). Only lastCommunication is reset, since that
   * field gates `isLightOnline()` and we can't trust pre-restart
   * timestamps for online detection.
   */
  loadFromDisk() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        const config = JSON.parse(data);

        if (config.desiredStates) {
          const entries = Object.entries(config.desiredStates).map(([lightId, state]) => [
            lightId,
            { ...state, lastCommunication: null }
          ]);
          this.desiredStates = new Map(entries);
          logger.info(`StateProxy: Loaded ${this.desiredStates.size} desired states from disk`);
        }
      }
    } catch (error) {
      logger.error('StateProxy: Failed to load from disk:', error.message);
    }
  }

  /**
   * Save state to disk (debounced)
   */
  saveToDisk() {
    clearTimeout(this.saveDebounceTimeout);
    
    this.saveDebounceTimeout = setTimeout(() => {
      try {
        const config = {
          desiredStates: Object.fromEntries(this.desiredStates),
          lastSaved: new Date().toISOString()
        };
        
        safeWriteJsonSync(this.configPath, config);
        logger.verbose('StateProxy: Saved to disk');
        
      } catch (error) {
        logger.error('StateProxy: Failed to save to disk:', error.message);
      }
    }, 1000); // Debounce 1 second
  }
}

module.exports = StateProxy;
module.exports.EnforceError = EnforceError;
