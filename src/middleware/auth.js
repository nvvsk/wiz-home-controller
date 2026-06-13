const auth = require('../auth');

/**
 * Express middleware that requires a valid bearer token on /api/* routes.
 * Allows through `/api/health` and `/api/auth/*` so the login screen and
 * health check can still reach the server.
 */
function requireAuth(req, res, next) {
  if (!auth.isEnabled()) return next();              // auth disabled in config
  if (req.path === '/health') return next();
  if (req.path.startsWith('/auth/')) return next();

  const header = req.get('authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1] : null;
  const payload = auth.verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.auth = payload;
  next();
}

module.exports = { requireAuth };
