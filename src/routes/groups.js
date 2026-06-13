const express = require('express');
const { validateLightControl } = require('../utils/validators');

module.exports = (groupManager, io) => {
  const router = express.Router();

  router.get('/', (req, res) => {
    try {
      const groups = groupManager.getAllGroups();
      res.json({ groups });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/:id', (req, res) => {
    try {
      const group = groupManager.getGroup(req.params.id);
      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }
      
      res.json(group);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const { name, description, lights, groups } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: 'name is required' });
      }
      
      const group = await groupManager.createGroup(name, description, lights, groups);
      io.emit('group:created', group);
      
      res.status(201).json({ success: true, group });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/order', async (req, res) => {
    try {
      const { order } = req.body;
      
      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'order must be an array' });
      }
      
      await groupManager.updateGroupOrder(order);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const group = await groupManager.updateGroup(req.params.id, req.body);
      io.emit('group:updated', group);
      
      res.json({ success: true, group });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      await groupManager.deleteGroup(req.params.id);
      io.emit('group:deleted', { id: req.params.id });
      
      res.json({ success: true, message: 'Group deleted' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/:id/control', async (req, res) => {
    const validationError = validateLightControl(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    try {
      const stateProxy = req.app.get('stateProxy');
      const group = groupManager.getGroup(req.params.id);
      if (!group) return res.status(404).json({ error: 'Group not found' });

      const allLights = groupManager.getAllLightsInGroup(req.params.id);

      // Parallel — one slow/dead bulb in a group of 10 used to add
      // up to 5s × N of API latency. Promise.allSettled fans the commands
      // out so the response is bounded by the slowest single bulb.
      const settled = await Promise.allSettled(
        allLights.map(lightId => stateProxy.setDesiredState(lightId, req.body, 'user'))
      );

      const results = [];
      const errors = [];
      const enforced = [];
      settled.forEach((r, i) => {
        const lightId = allLights[i];
        if (r.status === 'fulfilled') {
          results.push({ lightId, success: true });
        } else if (r.reason?.code === 'ENFORCED') {
          enforced.push({ lightId, enforcedBy: r.reason.enforcedBy || [] });
        } else {
          errors.push({ lightId, error: r.reason?.message || String(r.reason) });
        }
      });

      io.emit('group:controlled', {
        groupId: req.params.id,
        payload: req.body,
        results
      });

      res.json({
        success: true,
        totalLights: allLights.length,
        successful: results.length,
        enforcedCount: enforced.length,
        enforced,
        failed: errors.length,
        errors
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
