const express = require('express');
const { validateLightControl } = require('../utils/validators');

module.exports = (lightManager, io) => {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const lights = lightManager.getAllLights();
      const groupManager = req.app.get('groupManager');
      const stateProxy = req.app.get('stateProxy');

      // Fast mode: skip group lookup
      const fast = req.query.fast === 'true';

      const result = lights.map(light => {
        const actual = stateProxy?.actualStates?.get(light.id);

        // Single source of truth for liveness — see StateProxy.isLightOnline.
        const online = stateProxy ? stateProxy.isLightOnline(light.id) : true;

        // Status reflects ONLY what the bulb has actually reported. We don't
        // substitute desired state — that would let the dashboard tell users
        // a light is in a state it never reached.
        const status = actual
          ? {
              state: actual.state,
              brightness: actual.brightness,
              temperature: actual.temperature,
              rssi: actual.rssi
            }
          : null;

        return {
          ...light,
          groups: fast ? [] : groupManager.getLightGroups(light.id),
          status,
          online
        };
      });

      res.json({ lights: result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/sync/enable', async (req, res) => {
    try {
      const lights = lightManager.getAllLights();
      const pushManager = req.app.get('pushManager');
      
      if (!pushManager) {
        return res.status(500).json({ error: 'Push manager not available' });
      }
      
      if (pushManager.syncEnabled) {
        return res.json({ 
          success: true, 
          message: 'syncPilot already enabled',
          count: lights.length,
          alreadyEnabled: true
        });
      }
      
      for (const light of lights) {
        pushManager.enableKeepAlive(light.ip, light.mac);
      }
      
      pushManager.syncEnabled = true;
      
      res.json({ 
        success: true, 
        message: `syncPilot keep-alive enabled for ${lights.length} lights`,
        count: lights.length
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/sync/disable', async (req, res) => {
    try {
      const lights = lightManager.getAllLights();
      const pushManager = req.app.get('pushManager');
      
      if (!pushManager) {
        return res.status(500).json({ error: 'Push manager not available' });
      }
      
      pushManager.disableAllKeepAlive();
      pushManager.syncEnabled = false;
      
      res.json({ 
        success: true, 
        message: `syncPilot keep-alive disabled for all lights`
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const light = lightManager.getLight(req.params.id);
      if (!light) {
        return res.status(404).json({ error: 'Light not found' });
      }

      const stateProxy = req.app.get('stateProxy');
      const groupManager = req.app.get('groupManager');
      const desired = stateProxy.desiredStates.get(req.params.id) || {};
      const actual = stateProxy.actualStates.get(req.params.id);

      // Same contract as the list endpoint: status reflects actual reports
      // only (no fallback to desired), online comes from isLightOnline.
      const status = actual
        ? {
            state: actual.state,
            brightness: actual.brightness,
            temperature: actual.temperature,
            rssi: actual.rssi
          }
        : null;

      res.json({
        id: light.id,
        name: light.name,
        ip: light.ip,
        mac: light.mac,
        groups: groupManager.getLightGroups(light.id),
        status,
        desired,
        online: stateProxy.isLightOnline(light.id)
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update light order
  router.put('/order', async (req, res) => {
    try {
      const { order } = req.body;
      
      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'order must be an array' });
      }
      
      await lightManager.updateLightOrder(order);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/:id', async (req, res) => {
    const validationError = validateLightControl(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    try {
      const stateProxy = req.app.get('stateProxy');
      const light = lightManager.getLight(req.params.id);
      if (!light) return res.status(404).json({ error: 'Light not found' });

      // Route through StateProxy - single source of truth
      await stateProxy.setDesiredState(req.params.id, req.body, 'user');

      // Emit WebSocket event
      io.emit('light:command', {
        id: req.params.id,
        action: 'update',
        payload: req.body
      });

      res.json({ success: true });
    } catch (error) {
      if (error.code === 'ENFORCED') {
        return res.status(409).json({
          error: 'Light is enforced',
          lightId: error.lightId,
          enforcedBy: error.enforcedBy
        });
      }
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const { name, groups } = req.body;
      const updates = {};
      
      // Update name if provided
      if (name !== undefined) {
        if (!name.trim()) {
          return res.status(400).json({ error: 'Name cannot be empty' });
        }
        const light = await lightManager.updateLightName(req.params.id, name.trim());
        updates.name = light.name;
      }
      
      // Update groups if provided
      if (groups !== undefined) {
        if (!Array.isArray(groups)) {
          return res.status(400).json({ error: 'Groups must be an array' });
        }
        const groupManager = req.app.get('groupManager');
        await groupManager.updateLightGroups(req.params.id, groups);
        updates.groups = groups;
      }
      
      // Emit WebSocket event with updates
      io.emit('light:updated', { id: req.params.id, ...updates });
      
      res.json({ success: true, light: { id: req.params.id, ...updates } });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });


  return router;
};
