const auth = require('../auth');

/**
 * Express middleware that requires an authenticated session on /api/* routes.
 * Allows /api/health and /api/auth/* through so the login flow can run.
 */
function requireAuth(req, res, next) {
  if (!auth.isEnabled()) return next();
  if (req.path === '/health') return next();
  if (req.path.startsWith('/auth/')) return next();

  const user = req.session?.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.auth = user;
  next();
}

module.exports = { requireAuth };
