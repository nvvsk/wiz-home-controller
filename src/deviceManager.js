const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');
const { safeWriteJson } = require('./utils/safeWrite');

class DeviceManager {
  constructor(lightManager = null) {
    this.discoveredDevices = new Map(); // Devices found on network but not added
    this.configPath = path.join(__dirname, '../config/lights.json');
    this.lightManager = lightManager;
  }

  // Add discovered device (not yet added to config)
  addDiscoveredDevice(ip, mac, modelConfig = {}) {
    const deviceId = mac.toLowerCase().replace(/:/g, '');
    
    if (!this.discoveredDevices.has(deviceId)) {
      const device = {
        id: deviceId,
        ip,
        mac: deviceId,
        modelConfig,
        discoveredAt: new Date().toISOString(),
        source: 'firstBeat'
      };
      
      this.discoveredDevices.set(deviceId, device);
      logger.info(`New device discovered: ${ip} (${mac})`);
      return device;
    }
    
    return this.discoveredDevices.get(deviceId);
  }

  // Get all discovered devices (not yet added)
  getDiscoveredDevices() {
    if (!this.lightManager) {
      // If no lightManager injected, return all discovered devices
      return Array.from(this.discoveredDevices.values());
    }
    
    const configuredMacs = new Set(this.lightManager.getAllLights().map(l => l.mac));
    
    // Filter out devices that are already configured
    return Array.from(this.discoveredDevices.values()).filter(device => 
      !configuredMacs.has(device.mac)
    );
  }

  // Remove from discovered list
  removeDiscoveredDevice(deviceId) {
    return this.discoveredDevices.delete(deviceId);
  }

  // Clear all discovered devices
  clearDiscoveredDevices() {
    this.discoveredDevices.clear();
  }

  // Add device to config (move from discovered to configured)
  async addDeviceToConfig(deviceId, name = null) {
    const device = this.discoveredDevices.get(deviceId);
    if (!device) {
      throw new Error('Device not found in discovered list');
    }

    // Load current config
    const configData = await fs.readFile(this.configPath, 'utf8');
    const config = JSON.parse(configData);

    // Check if already exists
    const exists = config.lights.some(l => l.id === deviceId || l.mac === deviceId);
    if (exists) {
      throw new Error('Device already added to configuration');
    }

    // Generate name using last 4 characters of MAC if no name provided
    const defaultName = name || `WiZ Light ${device.mac.slice(-4)}`;
    
    // Create new light entry
    const newLight = {
      id: deviceId,
      name: defaultName,
      ip: device.ip,
      mac: device.mac,
      groups: ['all']
    };

    // Add to config
    config.lights.push(newLight);

    // Save config
    await safeWriteJson(this.configPath, config);

    // Remove from discovered list
    this.discoveredDevices.delete(deviceId);

    logger.info(`Device added to config: ${newLight.name} (${device.ip})`);
    return newLight;
  }

  // Add all discovered devices
  async addAllDiscoveredDevices() {
    const devices = this.getDiscoveredDevices();
    const added = [];

    for (const device of devices) {
      try {
        const light = await this.addDeviceToConfig(device.id);
        added.push(light);
      } catch (error) {
        logger.error(`Failed to add device ${device.id}:`, error.message);
      }
    }

    return added;
  }

  // Remove device from config
  async removeDeviceFromConfig(deviceId) {
    try {
      logger.info(`Attempting to remove device: ${deviceId}`);
      logger.info(`Config path: ${this.configPath}`);
      
      const configData = await fs.readFile(this.configPath, 'utf8');
      const config = JSON.parse(configData);

      logger.info(`Current lights count: ${config.lights.length}`);
      
      const initialLength = config.lights.length;
      config.lights = config.lights.filter(l => l.id !== deviceId && l.mac !== deviceId);

      if (config.lights.length === initialLength) {
        logger.warn(`Device ${deviceId} not found in configuration`);
        throw new Error('Device not found in configuration');
      }

      logger.info(`Lights after removal: ${config.lights.length}`);

      // Also remove from groups
      config.lights.forEach(light => {
        if (light.groups) {
          light.groups = light.groups.filter(g => g !== deviceId);
        }
      });

      await safeWriteJson(this.configPath, config);
      logger.info(`Device removed from config: ${deviceId}`);
      
      return true;
    } catch (error) {
      logger.error(`Error removing device ${deviceId}:`, error);
      throw error;
    }
  }

  // Get device count
  getStats() {
    return {
      discovered: this.discoveredDevices.size,
      configured: 0 // Will be set by lightManager
    };
  }
}

module.exports = DeviceManager;
