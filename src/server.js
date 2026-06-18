const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const logger = require('./logger');
const WizDiscovery = require('./discovery');
const PushManager = require('./pushManager');
const LightManager = require('./lightManager');
const DeviceManager = require('./deviceManager');
const StateProxy = require('./stateProxy');
const AutomationEngine = require('./automationEngine');
const auth = require('./auth');
const { requireAuth } = require('./middleware/auth');

class WizServer {
  constructor(port = 3000) {
    this.port = port;
    this.app = express();
    this.server = http.createServer(this.app);

    // Single session middleware shared by Express and socket.io so the same
    // cookie authenticates both HTTP requests and WebSocket connections.
    // Session secret: env var preferred; a per-process random fallback keeps
    // dev runs working but invalidates sessions across restarts.
    const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
    if (!process.env.SESSION_SECRET) {
      logger.warn('auth: SESSION_SECRET not set — using ephemeral secret. Sessions will reset on restart.');
    }
    this.sessionMiddleware = session({
      store: new SQLiteStore({
        db: 'sessions.db',
        dir: path.join(__dirname, '..', 'config'),
      }),
      name: 'wiz.sid',
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.SESSION_COOKIE_SECURE === '1',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      },
    });

    this.io = new Server(this.server, {
      cors: {
        origin: true,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE']
      }
    });

    // Share the session middleware with socket.io so socket.request.session
    // is populated on every handshake (works for both polling and websocket).
    this.io.engine.use(this.sessionMiddleware);

    // Reject WebSocket connections that don't have an authenticated session.
    // No-op when auth is disabled.
    this.io.use((socket, next) => {
      if (!auth.isEnabled()) return next();
      const userSession = socket.request?.session?.user;
      if (!userSession) return next(new Error('Unauthorized'));
      next();
    });
    
    this.discovery = new WizDiscovery();
    this.pushManager = new PushManager();
    this.lightManager = new LightManager();
    this.deviceManager = new DeviceManager(this.lightManager);
    this.groupManager = new (require('./groupManager'))(this.lightManager);
    
    // Initialize StateProxy and AutomationEngine
    this.stateProxy = new StateProxy(this.lightManager);
    this.automationEngine = new AutomationEngine(this.stateProxy, this.groupManager);

    // Forward engine FSM transitions to WebSocket clients so the UI's
    // Play/Stop button reflects reality without needing to poll.
    this.automationEngine.on('automation:state-change', (data) => {
      this.io.emit('automation:state-change', data);
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupStaticFiles();
    this.setupWebSocket();
  }

  setupMiddleware() {
    // Behind nginx / Authentik proxies, trust X-Forwarded-* so secure cookies
    // and req.ip work correctly. Disabled by default for direct LAN use.
    if (process.env.SESSION_TRUST_PROXY === '1') {
      this.app.set('trust proxy', 1);
    }
    this.app.use(cors({ origin: true, credentials: true }));
    this.app.use(express.json());
    this.app.use(this.sessionMiddleware);

    this.app.use((req, res, next) => {
      logger.verbose(`${req.method} ${req.path}`);
      next();
    });
    
    this.app.use((err, req, res, next) => {
      logger.error('Request error:', err);
      res.status(500).json({ error: err.message });
    });
  }

  setupRoutes() {
    this.app.set('pushManager', this.pushManager);
    this.app.set('groupManager', this.groupManager);
    this.app.set('stateProxy', this.stateProxy);
    this.app.set('automationEngine', this.automationEngine);
    // Expose IP-sync helper so route handlers (e.g. /devices/scan) can update
    // IPs *and* re-arm keep-alives in a single call, just like syncPilot does.
    this.app.set('syncLightIp', (mac, ip) => this.syncLightIp(mac, ip));
    
    // Auth endpoints (login/status) — must be mounted BEFORE the auth
    // middleware so the login screen can reach them without a token.
    this.app.use('/api/auth', require('./routes/auth')());

    // From here on, /api/* requires a valid bearer token (except /api/health
    // and /api/auth/* which the middleware lets through).
    this.app.use('/api', requireAuth);

    const lightsRouter = require('./routes/lights')(this.lightManager, this.io);
    const groupsRouter = require('./routes/groups')(this.groupManager, this.io);
    const discoveryRouter = require('./routes/discovery')(this.discovery);
    const devicesRouter = require('./routes/devices')(this.deviceManager, this.lightManager, this.io);
    const automationsRouter = require('./routes/automations')(this.automationEngine, this.io);
    
    this.app.use('/api/lights', lightsRouter);
    this.app.use('/api/groups', groupsRouter);
    this.app.use('/api/discovery', discoveryRouter);
    this.app.use('/api/devices', devicesRouter);
    this.app.use('/api/automations', automationsRouter);
    
    this.app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
  }

  setupStaticFiles() {
    // Serve frontend static files
    const frontendPath = path.join(__dirname, '../frontend/dist');

    // Hashed assets are content-addressed by Vite (e.g. index-aB12cD.js),
    // so their URL changes on every build — safe to cache forever.
    this.app.use('/assets', express.static(path.join(frontendPath, 'assets'), {
      immutable: true,
      maxAge: '1y'
    }));

    // Everything else under the frontend dir (favicon, etc.) — short cache.
    // index:false so the static middleware doesn't auto-serve index.html
    // before our explicit fallback below applies no-cache headers.
    this.app.use(express.static(frontendPath, { maxAge: '1h', index: false }));

    // SPA fallback — serve index.html for all non-API routes.
    // index.html itself MUST NOT be cached, otherwise browsers keep pointing
    // at hashed asset filenames that no longer exist after the next build.
    this.app.get(/^(?!\/api|\/socket\.io).*$/, (req, res) => {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(frontendPath, 'index.html'), (err) => {
        if (err) {
          logger.warn('Frontend not built. Run "cd frontend && npm run build" first.');
          res.status(404).send('Frontend not found. Please build the frontend first: cd frontend && npm run build');
        }
      });
    });
  }

  setupWebSocket() {
    this.io.on('connection', (socket) => {
      logger.info(`WebSocket client connected: ${socket.id}`);
      
      socket.emit('connected', { 
        message: 'Connected to WiZ Home Controller',
        timestamp: new Date().toISOString()
      });
      
      socket.on('disconnect', () => {
        logger.info(`WebSocket client disconnected: ${socket.id}`);
      });
    });
  }

  /**
   * Sync the configured IP for the light with this MAC to the given source IP.
   * Returns true if the MAC matched a configured light (whether or not the IP
   * actually changed), false if no light has that MAC. Callers use the return
   * value to decide whether to fall through to "new device" handling.
   *
   * Used by every channel that brings in a (mac, source-ip) pair: syncPilot
   * pushes, firstBeat broadcasts, and manual scans.
   */
  syncLightIp(mac, sourceIp) {
    if (!mac || !sourceIp) return false;
    const macClean = String(mac).toLowerCase().replace(/:/g, '');
    const light = this.lightManager.getAllLights().find(l => l.mac === macClean);
    if (!light) return false;

    this.lightManager.updateLightIp(light.id, sourceIp).then(changed => {
      if (!changed) return;
      // IP moved — send a fresh registration so the bulb starts pushing to us
      // from its new IP. register() clears+replaces the keep-alive timer if
      // one was active, otherwise it's just a one-shot.
      const keepAlive = this.pushManager.keepAliveTimers.has(macClean);
      this.pushManager.register(sourceIp, macClean, keepAlive).catch(err =>
        logger.error(`Failed to re-register ${light.name} at ${sourceIp}: ${err.message}`));
    }).catch(err => logger.error(`Failed to sync IP for ${light.name}: ${err.message}`));

    return true;
  }

  async start() {
    // OIDC discovery is async — must complete before we accept any HTTP or
    // WebSocket traffic that the auth middleware will gate.
    await auth.init();

    await this.lightManager.loadConfig();
    await this.groupManager.loadConfig();
    
    // Initialize StateProxy with current light states
    await this.stateProxy.initialize();
    
    const lights = this.lightManager.getAllLights();
    if (lights.length > 0) {
      const firstLight = lights[0];
      await this.pushManager.start(firstLight.ip);

      // Enable keep-alive at startup so the server keeps receiving syncPilot
      // heartbeats 24/7 — independent of whether the dashboard is open.
      // Required for enforce automations to detect drift while no UI is loaded.
      for (const light of lights) {
        await this.pushManager.register(light.ip, light.mac, true);
        
        this.pushManager.subscribe(light.mac, (params, rinfo) => {
          // Source IP is authoritative — always sync (lightManager no-ops on same IP).
          this.syncLightIp(light.mac, rinfo?.address);

          const update = {
            mac: light.mac,
            id: light.id,
            name: light.name,
            state: params.state,
            brightness: params.dimming,
            temperature: params.temp,
            rgb: params.r !== undefined ? { r: params.r, g: params.g, b: params.b } : null,
            rssi: params.rssi,
            source: params.src,
            timestamp: new Date().toISOString()
          };

          // Feed actual state to StateProxy
          this.stateProxy.onLightStatusUpdate(light.id, {
            state: params.state,
            brightness: params.dimming,
            temperature: params.temp,
            rssi: params.rssi
          });

          this.io.emit('light:update', update);
          logger.verbose(`${light.name}: ${params.state ? 'ON' : 'OFF'}${params.dimming ? ' ' + params.dimming + '%' : ''}`);
        });
      }
      
      // firstBeat arrives when a bulb powers on. If already configured, sync
      // its IP (DHCP may have given it a new lease). Otherwise add as a new
      // device for the user to onboard.
      this.pushManager.on('firstBeat', (ip, mac, modelConfig) => {
        const macClean = String(mac).toLowerCase().replace(/:/g, '');
        if (this.syncLightIp(macClean, ip)) return; // configured — IP synced, done
        const device = this.deviceManager.addDiscoveredDevice(ip, mac, modelConfig);
        this.io.emit('device:discovered', device);
      });
      
      this.pushManager.syncEnabled = true;
      logger.info(`Registered ${lights.length} lights with keep-alive enabled`);
    }
    
    // Recover automations BEFORE pushes arrive so enforce is active
    await this.automationEngine.recoverFromRestart();
    this.automationEngine.startScheduler();
    
    this.server.listen(this.port, () => {
      logger.info('');
      logger.info('='.repeat(60));
      logger.info('🚀 WiZ Home Controller Server Started');
      logger.info('='.repeat(60));
      logger.info(`🌐 Frontend: http://localhost:${this.port}`);
      logger.info(`📡 API: http://localhost:${this.port}/api`);
      logger.info(`🔌 WebSocket: ws://localhost:${this.port}`);
      logger.info(`💡 Lights configured: ${lights.length}`);
      logger.info('='.repeat(60));
      logger.info('');
    });
  }

  async stop() {
    this.automationEngine.stopScheduler();
    await this.pushManager.stop();
    this.server.close();
    logger.info('Server stopped');
  }
}

module.exports = WizServer;
