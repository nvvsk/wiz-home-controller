const { Issuer, generators } = require('openid-client');
const logger = require('./logger');

/**
 * OIDC client setup (BFF pattern).
 *
 * The express server is both the OIDC client and the API host. Browsers never
 * see tokens — login state lives in a server-side session keyed by an HTTP-only
 * cookie. See src/routes/auth.js for the redirect / callback / logout endpoints
 * and src/middleware/auth.js for the per-request session check.
 *
 * Auth is ENABLED when all required OIDC_* env vars are set. If any are missing,
 * the server runs unauthenticated (same fail-open behavior as the prior password
 * mode), so dev environments work without configuration.
 */

let oidcClient = null;
let issuer = null;
let authEnabled = false;
let initPromise = null;

function readConfig() {
  return {
    issuerUrl:        process.env.OIDC_ISSUER_URL,
    clientId:         process.env.OIDC_CLIENT_ID,
    clientSecret:     process.env.OIDC_CLIENT_SECRET,
    redirectUri:      process.env.OIDC_REDIRECT_URI,
    postLogoutUri:    process.env.OIDC_POST_LOGOUT_REDIRECT_URI,
    scope:            process.env.OIDC_SCOPE || 'openid profile email',
  };
}

function configIsComplete(cfg) {
  return Boolean(cfg.issuerUrl && cfg.clientId && cfg.clientSecret && cfg.redirectUri);
}

async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const cfg = readConfig();
    if (!configIsComplete(cfg)) {
      authEnabled = false;
      logger.warn('auth: OIDC env vars not fully set — authentication DISABLED. Set OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI to enable.');
      return;
    }
    try {
      issuer = await Issuer.discover(cfg.issuerUrl);
      oidcClient = new issuer.Client({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uris: [cfg.redirectUri],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_basic',
      });
      authEnabled = true;
      logger.info(`auth: OIDC enabled — issuer=${issuer.issuer}`);
    } catch (err) {
      authEnabled = false;
      logger.error(`auth: OIDC discovery failed (${cfg.issuerUrl}): ${err.message}`);
      logger.error('auth: server starting with authentication DISABLED.');
    }
  })();
  return initPromise;
}

function isEnabled() { return authEnabled; }

function getClient() {
  if (!authEnabled) throw new Error('OIDC client not initialized');
  return oidcClient;
}

function getIssuer() {
  if (!authEnabled) throw new Error('OIDC issuer not initialized');
  return issuer;
}

function getScope() {
  return readConfig().scope;
}

/**
 * Build the URL we redirect the browser to so the user can authenticate.
 * Caller must persist the returned code_verifier / state / nonce in the user's
 * session and pass them back in handleCallback().
 */
function buildAuthUrl() {
  const code_verifier = generators.codeVerifier();
  const code_challenge = generators.codeChallenge(code_verifier);
  const state = generators.state();
  const nonce = generators.nonce();
  const url = oidcClient.authorizationUrl({
    scope: getScope(),
    code_challenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });
  return { url, code_verifier, state, nonce };
}

/**
 * Exchange the authorization code for tokens, verify everything, and return
 * the normalized user object we store in the session.
 *
 * `params` is what `oidcClient.callbackParams(req)` returned — i.e. the query
 * string from the callback URL.
 */
async function handleCallback(params, expected) {
  const cfg = readConfig();
  const tokenSet = await oidcClient.callback(cfg.redirectUri, params, {
    code_verifier: expected.code_verifier,
    state: expected.state,
    nonce: expected.nonce,
  });
  const claims = tokenSet.claims();
  return {
    sub: claims.sub,
    email: claims.email || null,
    name: claims.name || null,
    preferred_username: claims.preferred_username || null,
    groups: Array.isArray(claims.groups) ? claims.groups : [],
    id_token: tokenSet.id_token,           // needed for federated logout
    issued_at: Math.floor(Date.now() / 1000),
  };
}

function hasLogoutEndpoint() {
  return Boolean(authEnabled && issuer?.metadata?.end_session_endpoint);
}

function buildLogoutUrl(idToken) {
  const cfg = readConfig();
  return oidcClient.endSessionUrl({
    id_token_hint: idToken,
    post_logout_redirect_uri: cfg.postLogoutUri || cfg.redirectUri.replace(/\/api\/auth\/callback$/, '/'),
  });
}

module.exports = {
  init,
  isEnabled,
  getClient,
  getIssuer,
  buildAuthUrl,
  handleCallback,
  hasLogoutEndpoint,
  buildLogoutUrl,
};
