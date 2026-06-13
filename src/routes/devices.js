const express = require('express');

module.exports = (deviceManager, lightManager, io) => {
  const router = express.Router();

  // Get all discovered devices (not yet added)
  router.get('/discovered', (req, res) => {
    try {
      const devices = deviceManager.getDiscoveredDevices();
      res.json({ devices, count: devices.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all configured devices
  router.get('/configured', (req, res) => {
    try {
      const lights = lightManager.getAllLights();
      res.json({ devices: lights, count: lights.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get device stats
  router.get('/stats', (req, res) => {
    try {
      const stats = deviceManager.getStats();
      stats.configured = lightManager.getAllLights().length;
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Add single discovered device to config
  router.post('/discovered/:id/add', async (req, res) => {
    try {
      const { name } = req.body;
      const device = await deviceManager.addDeviceToConfig(req.params.id, name);
      
      // Reload light manager to pick up new device
      await lightManager.loadConfig();
      
      // Register new light with push manager
      const pushManager = req.app.get('pushManager');
      const lightObj = lightManager.getLight(device.id);
      
      if (pushManager && lightObj) {
        // Match the server-startup behavior — keep-alive on, so the bulb
        // keeps pushing without depending on a browser session.
        await pushManager.register(lightObj.ip, lightObj.mac, true);
        pushManager.subscribe(lightObj.mac, (params, rinfo) => {
          const update = {
            mac: lightObj.mac,
            id: lightObj.id,
            name: lightObj.name,
            state: params.state,
            brightness: params.dimming,
            temperature: params.temp,
            rgb: params.r !== undefined ? { r: params.r, g: params.g, b: params.b } : null,
            rssi: params.rssi,
            source: params.src,
            timestamp: new Date().toISOString()
          };
          io.emit('light:update', update);
        });
      }
      
      // Emit WebSocket event with full light object
      const fullLight = lightObj ? {
        id: lightObj.id,
        name: lightObj.name,
        ip: lightObj.ip,
        mac: lightObj.mac,
        groups: lightObj.groups
      } : device;
      
      io.emit('device:added', { device: fullLight });
      
      res.json({ success: true, device: fullLight });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Add all discovered devices
  router.post('/discovered/add-all', async (req, res) => {
    try {
      const devices = await deviceManager.addAllDiscoveredDevices();
      
      // Reload light manager
      await lightManager.loadConfig();
      
      // Emit WebSocket event
      io.emit('devices:added', { devices, count: devices.length });
      
      res.json({ success: true, devices, count: devices.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Remove discovered device from list (ignore it)
  router.delete('/discovered/:id', (req, res) => {
    try {
      const removed = deviceManager.removeDiscoveredDevice(req.params.id);
      if (!removed) {
        return res.status(404).json({ error: 'Device not found' });
      }
      
      io.emit('device:ignored', { id: req.params.id });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Clear all discovered devices
  router.delete('/discovered', (req, res) => {
    try {
      deviceManager.clearDiscoveredDevices();
      io.emit('devices:cleared');
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Remove device from config
  router.delete('/configured/:id', async (req, res) => {
    try {
      // Get light info before removing
      const light = lightManager.getLight(req.params.id);
      
      await deviceManager.removeDeviceFromConfig(req.params.id);
      
      // Unsubscribe from push manager
      const pushManager = req.app.get('pushManager');
      if (pushManager && light) {
        pushManager.unsubscribe(light.mac);
      }
      
      // Reload light manager
      await lightManager.loadConfig();
      
      // Emit WebSocket event
      io.emit('device:removed', { id: req.params.id });
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error removing device:', error);
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });

  // Trigger network scan
  router.post('/scan', async (req, res) => {
    try {
      console.log('Starting network scan...');
      
      // Reload config to get fresh list of configured devices
      await lightManager.loadConfig();
      
      const WizDiscovery = require('../discovery');
      const discovery = new WizDiscovery();
      
      // Scan network
      const devices = await discovery.discoverLights();
      console.log(`Found ${devices.length} devices:`, devices.map(d => ({ ip: d.ip, mac: d.mac })));
      
      // For each scanned device:
      //   - if MAC is already configured → use server.syncLightIp so the IP
      //     update AND any keep-alive re-arm happen together
      //   - if MAC is new → add to "discovered" list for the user to onboard
      const syncLightIp = req.app.get('syncLightIp');
      let addedCount = 0;
      for (const device of devices) {
        const mac = device.mac.toLowerCase().replace(/:/g, '');
        if (syncLightIp(mac, device.ip)) continue; // configured — sync handled the rest

        const discoveredDevice = deviceManager.addDiscoveredDevice(device.ip, mac, device.modelConfig);
        if (discoveredDevice) {
          io.emit('device:discovered', discoveredDevice);
          addedCount++;
        }
      }
      
      console.log(`Scan complete: ${addedCount} new devices discovered`);
      
      res.json({ 
        success: true, 
        devices,
        discovered: addedCount,
        total: devices.length 
      });
    } catch (error) {
      console.error('Scan error:', error);
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });

  return router;
};
