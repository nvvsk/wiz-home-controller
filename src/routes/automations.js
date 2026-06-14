const express = require('express');
const logger = require('../logger');
const { validateAutomation } = require('../utils/validators');

module.exports = (automationEngine, io) => {
  const router = express.Router();

  /**
   * @swagger
   * /api/automations:
   *   get:
   *     summary: Get all automations
   *     tags: [Automations]
   *     responses:
   *       200:
   *         description: List of automations
   */
  router.get('/', (req, res) => {
    try {
      let automations = automationEngine.getAllAutomations();
      // Optional ?type=scene|automation filter. Treat missing type as 'automation'.
      const filter = req.query.type;
      if (filter === 'scene') {
        automations = automations.filter(a => a.type === 'scene');
      } else if (filter === 'automation') {
        automations = automations.filter(a => a.type !== 'scene');
      }
      res.json(automations);
    } catch (error) {
      logger.error('Failed to get automations:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * @swagger
   * /api/automations/{id}:
   *   get:
   *     summary: Get automation by ID
   *     tags: [Automations]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Automation details
   *       404:
   *         description: Automation not found
   */
  router.get('/:id', (req, res) => {
    try {
      const automation = automationEngine.getAutomation(req.params.id);
      if (!automation) {
        return res.status(404).json({ error: 'Automation not found' });
      }
      res.json(automation);
    } catch (error) {
      logger.error('Failed to get automation:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * @swagger
   * /api/automations:
   *   post:
   *     summary: Create new automation
   *     tags: [Automations]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *               - schedule
   *               - progression
   *               - targets
   *             properties:
   *               name:
   *                 type: string
   *               schedule:
   *                 type: object
   *                 properties:
   *                   start:
   *                     type: string
   *                   end:
   *                     type: string
   *                   days:
   *                     type: array
   *                     items:
   *                       type: string
   *               progression:
   *                 type: object
   *                 properties:
   *                   type:
   *                     type: string
   *                   startState:
   *                     type: object
   *                   endState:
   *                     type: object
   *               targets:
   *                 type: object
   *                 properties:
   *                   lights:
   *                     type: array
   *                     items:
   *                       type: string
   *                   groups:
   *                     type: array
   *                     items:
   *                       type: string
   *     responses:
   *       201:
   *         description: Automation created
   */
  router.post('/', (req, res) => {
    const validationError = validateAutomation(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    try {
      const automation = automationEngine.createAutomation(req.body);

      // Emit to WebSocket clients
      io.emit('automation:created', automation);

      res.status(201).json(automation);
    } catch (error) {
      logger.error('Failed to create automation:', error);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * @swagger
   * /api/automations/{id}:
   *   put:
   *     summary: Update automation
   *     tags: [Automations]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: Automation updated
   *       404:
   *         description: Automation not found
   */
  router.put('/:id', (req, res) => {
    const validationError = validateAutomation(req.body, { allowPartial: true });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    try {
      // Snapshot run state BEFORE the update — the in-memory event keeps its
      // original endTime / isManual / enforce flags from when it started, so
      // the new schedule won't apply until the user stops and re-runs.
      const wasRunning = automationEngine.isAutomationRunning(req.params.id);

      const automation = automationEngine.updateAutomation(req.params.id, req.body);

      // Emit to WebSocket clients
      io.emit('automation:updated', automation);
      if (wasRunning) {
        io.emit('automation:edited-while-running', { id: automation.id, name: automation.name });
      }

      res.json(automation);
    } catch (error) {
      logger.error('Failed to update automation:', error);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * @swagger
   * /api/automations/{id}:
   *   delete:
   *     summary: Delete automation
   *     tags: [Automations]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Automation deleted
   *       404:
   *         description: Automation not found
   */
  router.delete('/:id', (req, res) => {
    try {
      automationEngine.deleteAutomation(req.params.id);
      
      // Emit to WebSocket clients
      io.emit('automation:deleted', { id: req.params.id });
      
      res.json({ message: 'Automation deleted' });
    } catch (error) {
      logger.error('Failed to delete automation:', error);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * @swagger
   * /api/automations/{id}/toggle:
   *   post:
   *     summary: Toggle automation enabled/disabled
   *     tags: [Automations]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Automation toggled
   */
  router.post('/:id/toggle', (req, res) => {
    try {
      const automation = automationEngine.getAutomation(req.params.id);
      if (!automation) {
        return res.status(404).json({ error: 'Automation not found' });
      }
      
      const updated = automationEngine.updateAutomation(req.params.id, {
        enabled: !automation.enabled
      });
      
      // Emit to WebSocket clients
      io.emit('automation:updated', updated);
      
      res.json(updated);
    } catch (error) {
      logger.error('Failed to toggle automation:', error);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * @swagger
   * /api/automations/{id}/trigger:
   *   post:
   *     summary: Manually trigger an automation
   *     tags: [Automations]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Automation triggered
   *       404:
   *         description: Automation not found
   */
  router.post('/:id/trigger', (req, res) => {
    try {
      const automation = automationEngine.triggerManually(req.params.id);
      
      // Emit to WebSocket clients
      io.emit('automation:triggered', { id: automation.id, name: automation.name });
      
      res.json({ 
        message: 'Automation triggered',
        automation: automation
      });
    } catch (error) {
      logger.error('Failed to trigger automation:', error);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * @swagger
   * /api/automations/{id}/stop:
   *   post:
   *     summary: Stop a running automation
   *     tags: [Automations]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Automation stopped
   *       404:
   *         description: Automation not found
   */
  // Stop semantics: stop the current run AND suspend the automation until
  // its next genuine scheduled start. Without the suspension, the 15-second
  // scheduler would immediately re-fire it while the window is still open.
  router.post('/:id/stop', (req, res) => {
    try {
      const automation = automationEngine.getAutomation(req.params.id);
      if (!automation) return res.status(404).json({ error: 'Automation not found' });

      automationEngine.releaseAutomation(req.params.id, 'user stopped');

      io.emit('automation:stopped', { id: automation.id, name: automation.name });

      res.json({
        message: 'Automation stopped',
        automation: automationEngine.getAutomation(req.params.id)
      });
    } catch (error) {
      logger.error('Failed to stop automation:', error);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * @swagger
   * /api/automations/events:
   *   post:
   *     summary: Trigger automations via event
   *     tags: [Automations]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - event
   *             properties:
   *               event:
   *                 type: string
   *               data:
   *                 type: object
   *     responses:
   *       200:
   *         description: Event processed
   */
  router.post('/events', (req, res) => {
    try {
      const { event, data } = req.body;
      
      if (!event) {
        return res.status(400).json({ error: 'Event type is required' });
      }
      
      automationEngine.handleEvent(event, data || {});
      
      res.json({ 
        message: 'Event processed',
        event: event
      });
    } catch (error) {
      logger.error('Failed to process event:', error);
      res.status(400).json({ error: error.message });
    }
  });

  return router;
};
