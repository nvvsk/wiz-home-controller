const express = require('express');
const auth = require('../auth');
const logger = require('../logger');

/**
 * BFF auth endpoints. The browser only ever sees these — never tokens.
 *
 *   GET  /api/auth/login    → redirect to Authentik
 *   GET  /api/auth/callback → handle code, set session, redirect back to app
 *   GET  /api/auth/logout   → destroy session, redirect through Authentik end_session
 *   GET  /api/auth/status   → "am I logged in? what's my profile?"
 */
module.exports = () => {
  const router = express.Router();

  router.get('/login', (req, res) => {
    if (!auth.isEnabled()) return res.redirect('/');
    try {
      const { url, code_verifier, state, nonce } = auth.buildAuthUrl();
      const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '/';
      req.session.oidc = { code_verifier, state, nonce, returnTo };
      req.session.save(err => {
        if (err) {
          logger.error('auth: failed to save session before redirect:', err);
          return res.status(500).send('Login failed');
        }
        res.redirect(url);
      });
    } catch (err) {
      logger.error('auth: failed to build authorization URL:', err);
      res.status(500).send('Login failed');
    }
  });

  router.get('/callback', async (req, res) => {
    if (!auth.isEnabled()) return res.redirect('/');
    const expected = req.session.oidc;
    if (!expected) {
      logger.warn('auth: callback hit without prior /login (no session.oidc)');
      return res.status(400).send('Invalid login session — please retry from the start.');
    }
    try {
      const params = auth.getClient().callbackParams(req);
      const user = await auth.handleCallback(params, expected);
      const returnTo = expected.returnTo || '/';
      delete req.session.oidc;
      req.session.user = user;
      req.session.save(err => {
        if (err) {
          logger.error('auth: failed to persist user session:', err);
          return res.status(500).send('Login failed');
        }
        logger.info(`auth: login ok for ${user.preferred_username || user.email || user.sub}`);
        res.redirect(returnTo);
      });
    } catch (err) {
      logger.error('auth: callback error:', err);
      res.status(401).send('Login failed: ' + err.message);
    }
  });

  router.get('/logout', (req, res) => {
    const user = req.session?.user;
    const idToken = user?.id_token;
    const who = user?.preferred_username || user?.email || user?.sub || 'anonymous';
    req.session.destroy(err => {
      if (err) logger.warn('auth: session destroy error (ignored):', err);
      res.clearCookie('wiz.sid');
      logger.info(`auth: logout for ${who}`);
      if (idToken && auth.hasLogoutEndpoint()) {
        return res.redirect(auth.buildLogoutUrl(idToken));
      }
      res.redirect('/');
    });
  });

  router.get('/status', (req, res) => {
    if (!auth.isEnabled()) {
      return res.json({ authenticated: true, authRequired: false });
    }
    const user = req.session?.user;
    if (!user) return res.json({ authenticated: false, authRequired: true });
    res.json({
      authenticated: true,
      authRequired: true,
      user: {
        sub: user.sub,
        name: user.name,
        email: user.email,
        username: user.preferred_username,
        groups: user.groups || [],
      },
    });
  });

  return router;
};
