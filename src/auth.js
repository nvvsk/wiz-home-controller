const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { safeWriteJsonSync } = require('./utils/safeWrite');

/**
 * Tiny auth module — single-user, HMAC-signed bearer tokens, no extra deps.
 *
 * Design:
 *  - Password is provided via the WIZ_PASSWORD env var.
 *    Without it, auth is disabled and the server logs a warning.
 *  - Tokens are HMAC-SHA256-signed (JWT-style: header.payload.signature).
 *  - The signing secret is persisted in config/auth.json so tokens survive
 *    restarts. The secret is generated on first run if missing.
 *  - Password verification uses scrypt with a per-process random salt
 *    (since there's only one password we keep it in memory).
 *
 * Replace this whole module with a real auth service later — it's deliberately
 * isolated for that reason.
 */

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'auth.json');
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;          // 7 days
const SCRYPT_KEYLEN = 64;

let tokenSecret = null;
let passwordHash = null;   // Buffer
let passwordSalt = null;   // Buffer
let authEnabled = false;

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function loadOrCreateSecret() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      if (data.tokenSecret && typeof data.tokenSecret === 'string') {
        return Buffer.from(data.tokenSecret, 'hex');
      }
    }
  } catch (e) {
    logger.warn(`auth: failed to read ${CONFIG_PATH}, regenerating: ${e.message}`);
  }
  const fresh = crypto.randomBytes(32);
  safeWriteJsonSync(CONFIG_PATH, { tokenSecret: fresh.toString('hex') });
  logger.info('auth: generated new token secret (config/auth.json)');
  return fresh;
}

function init() {
  const pw = process.env.WIZ_PASSWORD;
  if (!pw || !pw.trim()) {
    authEnabled = false;
    logger.warn('auth: WIZ_PASSWORD not set — authentication DISABLED. Set it via env var or pm2 ecosystem to require login.');
    return;
  }
  tokenSecret = loadOrCreateSecret();
  passwordSalt = crypto.randomBytes(16);
  passwordHash = crypto.scryptSync(pw, passwordSalt, SCRYPT_KEYLEN);
  authEnabled = true;
  logger.info('auth: enabled (single-user, 7-day token expiry)');
}

function isEnabled() { return authEnabled; }

function verifyPassword(input) {
  if (!authEnabled) return true;
  if (typeof input !== 'string') return false;
  try {
    const candidate = crypto.scryptSync(input, passwordSalt, SCRYPT_KEYLEN);
    return crypto.timingSafeEqual(candidate, passwordHash);
  } catch {
    return false;
  }
}

function signToken(payload = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { sub: 'user', iat: now, exp: now + TOKEN_TTL_SECONDS, ...payload };
  const headerB64 = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const bodyB64 = b64url(JSON.stringify(body));
  const signing = `${headerB64}.${bodyB64}`;
  const sig = crypto.createHmac('sha256', tokenSecret).update(signing).digest();
  return `${signing}.${b64url(sig)}`;
}

function verifyToken(token) {
  if (!authEnabled) return { sub: 'auth-disabled', exp: Number.MAX_SAFE_INTEGER };
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, bodyB64, sigB64] = parts;
  const signing = `${headerB64}.${bodyB64}`;
  const expected = crypto.createHmac('sha256', tokenSecret).update(signing).digest();
  const given = b64urlDecode(sigB64);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let body;
  try { body = JSON.parse(b64urlDecode(bodyB64).toString('utf8')); } catch { return null; }
  if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
  return body;
}

function getTokenTtl() { return TOKEN_TTL_SECONDS; }

module.exports = { init, isEnabled, verifyPassword, signToken, verifyToken, getTokenTtl };
