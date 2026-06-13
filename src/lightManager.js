const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');
const WizLight = require('./wizLight');
const { safeWriteJson } = require('./utils/safeWrite');

class LightManager {
  constructor() {
    this.lights = new Map();
    this.groups = new Map();
    this.configPath = path.join(__dirname, '..', 'config', 'lights.json');
  }

  async loadConfig() {
    try {
      const data = await fs.readFile(this.configPath, 'utf8');
      const config = JSON.parse(data);

      // Clear existing lights and groups before reloading
      this.lights.clear();
      this.groups.clear();

      for (const lightConfig of config.lights) {
        const light = {
          id: lightConfig.id,
          name: lightConfig.name,
          ip: lightConfig.ip,
          mac: lightConfig.mac,
          groups: lightConfig.groups || [],
          controller: new WizLight(lightConfig.ip)
        };
        this.lights.set(light.id, light);
      }

      for (const groupConfig of config.groups || []) {
        this.groups.set(groupConfig.id, {
          id: groupConfig.id,
          name: groupConfig.name,
          description: groupConfig.description || ''
        });
      }

      logger.info(`Loaded ${this.lights.size} lights and ${this.groups.size} groups`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Fresh install / file deleted — start empty and let the user add
        // devices via the Devices page (scan or auto-discovered firstBeat).
        logger.info('No lights config found, starting with empty set');
        await this.saveConfig();
        return;
      }
      logger.error('Failed to load config:', error.message);
      throw error;
    }
  }

  async saveConfig() {
    const config = {
      lights: Array.from(this.lights.values()).map(light => ({
        id: light.id,
        name: light.name,
        ip: light.ip,
        mac: light.mac
      }))
    };
    
    await safeWriteJson(this.configPath, config);
  }

  getLight(id) {
    return this.lights.get(id);
  }

  getAllLights() {
    return Array.from(this.lights.values()).map(light => ({
      id: light.id,
      name: light.name,
      ip: light.ip,
      mac: light.mac
    }));
  }

  getLightsByGroup(groupId) {
    return Array.from(this.lights.values())
      .filter(light => light.groups.includes(groupId))
      .map(light => ({
        id: light.id,
        name: light.name,
        ip: light.ip,
        mac: light.mac,
        groups: light.groups
      }));
  }

  getGroup(id) {
    return this.groups.get(id);
  }

  getAllGroups() {
    return Array.from(this.groups.values());
  }

  async updateLightName(id, name) {
    const light = this.lights.get(id);
    if (!light) {
      throw new Error(`Light ${id} not found`);
    }

    light.name = name;
    await this.saveConfig();
    return light;
  }

  /**
   * Update a light's IP based on the latest source IP observed for its MAC.
   * Called unconditionally from every syncPilot/firstBeat/scan — callers don't
   * need to compare. Returns `true` if the IP actually changed (in which case
   * keep-alive timers should be re-armed by the caller), `false` otherwise.
   */
  async updateLightIp(id, newIp) {
    const light = this.lights.get(id);
    if (!light || !newIp || light.ip === newIp) return false;

    const oldIp = light.ip;
    light.ip = newIp;
    light.controller = new WizLight(newIp);
    await this.saveConfig();
    logger.info(`Light "${light.name}" IP updated: ${oldIp} → ${newIp}`);
    return true;
  }

  async updateLightOrder(lightIds) {
    // Reorder lights map based on provided order
    const orderedLights = new Map();
    
    for (const id of lightIds) {
      const light = this.lights.get(id);
      if (light) {
        orderedLights.set(id, light);
      }
    }
    
    // Add any lights not in the order list (shouldn't happen, but safety)
    for (const [id, light] of this.lights.entries()) {
      if (!orderedLights.has(id)) {
        orderedLights.set(id, light);
      }
    }
    
    this.lights = orderedLights;
    await this.saveConfig();
    logger.verbose('Light order updated');
  }

  async removeLightFromGroup(lightId, groupId) {
    const light = this.lights.get(lightId);
    
    if (!light) throw new Error(`Light ${lightId} not found`);
    
    light.groups = light.groups.filter(g => g !== groupId);
    await this.saveConfig();
    
    return light;
  }

  async createGroup(id, name, description = '') {
    if (this.groups.has(id)) {
      throw new Error(`Group ${id} already exists`);
    }
    
    const group = { id, name, description };
    this.groups.set(id, group);
    await this.saveConfig();
    
    return group;
  }

  async deleteGroup(id) {
    if (!this.groups.has(id)) {
      throw new Error(`Group ${id} not found`);
    }
    
    for (const light of this.lights.values()) {
      light.groups = light.groups.filter(g => g !== id);
    }
    
    this.groups.delete(id);
    await this.saveConfig();
  }

  // Control light
  async controlLight(lightId, params, source = 'manual') {
    const light = this.getLight(lightId);
    if (!light) {
      throw new Error('Light not found');
    }

    if (!params || typeof params !== 'object') {
      throw new Error('Invalid control parameters');
    }

    // Execute control commands
    if (params.state !== undefined) {
      if (params.state === true || params.state === 'on') {
        await light.controller.turnOn();
      } else {
        await light.controller.turnOff();
      }
    }

    if (params.brightness !== undefined) {
      await light.controller.setBrightness(params.brightness);
    }

    if (params.temperature !== undefined) {
      await light.controller.setColorTemp(params.temperature, params.brightness);
    }

    if (params.rgb !== undefined) {
      const { r, g, b } = params.rgb;
      await light.controller.setRGB(r, g, b, params.brightness);
    }

    if (params.sceneId !== undefined) {
      await light.controller.setScene(params.sceneId);
    }

    return light;
  }

}

module.exports = LightManager;
