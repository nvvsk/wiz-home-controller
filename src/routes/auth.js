const express = require('express');
const auth = require('../auth');
const logger = require('../logger');

module.exports = () => {
  const router = express.Router();

  // POST /api/auth/login { password } → { token, expiresIn, authRequired }
  router.post('/login', (req, res) => {
    if (!auth.isEnabled()) {
      return res.json({ token: null, authRequired: false, message: 'Auth disabled' });
    }
    const { password } = req.body || {};
    if (!auth.verifyPassword(password)) {
      logger.warn(`auth: failed login attempt from ${req.ip}`);
      return res.status(401).json({ error: 'Invalid password' });
    }
    const token = auth.signToken();
    res.json({ token, expiresIn: auth.getTokenTtl(), authRequired: true });
  });

  // GET /api/auth/status — used by the frontend to check current token validity
  // on page load, without doing a privileged call first.
  router.get('/status', (req, res) => {
    if (!auth.isEnabled()) {
      return res.json({ authenticated: true, authRequired: false });
    }
    const header = req.get('authorization') || '';
    const m = header.match(/^Bearer\s+(.+)$/i);
    const payload = m ? auth.verifyToken(m[1]) : null;
    if (!payload) return res.json({ authenticated: false, authRequired: true });
    res.json({ authenticated: true, authRequired: true, exp: payload.exp });
  });

  return router;
};
