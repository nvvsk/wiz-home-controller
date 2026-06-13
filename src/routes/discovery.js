const express = require('express');

module.exports = (discovery) => {
  const router = express.Router();

  router.post('/scan', async (req, res) => {
    try {
      const { method = 'broadcast' } = req.body;
      
      let lights;
      if (method === 'subnet') {
        const { subnet } = req.body;
        if (!subnet) {
          return res.status(400).json({ error: 'subnet is required for subnet scan' });
        }
        lights = await discovery.discoverOnSubnet(subnet);
      } else {
        lights = await discovery.discoverLights();
      }
      
      res.json({ 
        success: true, 
        count: lights.length,
        lights: lights.map(light => ({
          ip: light.ip,
          mac: light.mac,
          rssi: light.rssi,
          state: light.state,
          brightness: light.dimming,
          temperature: light.temp
        }))
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
