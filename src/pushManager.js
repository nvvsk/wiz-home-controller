const dgram = require('dgram');
const os = require('os');
const EventEmitter = require('events');
const logger = require('./logger');

const LISTEN_PORT = 38900;
const RESPOND_PORT = 38899;
const KEEP_ALIVE_INTERVAL = 20000;

let instance = null;

class PushManager extends EventEmitter {
  constructor() {
    super();
    
    if (instance) {
      return instance;
    }
    
    this.socket = null;
    this.broadcastSocket = null;
    this.running = false;
    this.syncEnabled = false;
    this.subscriptions = new Map();
    this.registeredLights = new Set();
    this.keepAliveTimers = new Map();
    this.offlineLights = new Set(); // Track offline lights to avoid EHOSTUNREACH
    this.phoneMac = this.generateMac();
    this.phoneIp = null;
    
    instance = this;
  }

  generateMac() {
    const hex = '0123456789ABCDEF';
    let mac = '';
    for (let i = 0; i < 6; i++) {
      if (i > 0) mac += ':';
      mac += hex.charAt(Math.floor(Math.random() * 16));
      mac += hex.charAt(Math.floor(Math.random() * 16));
    }
    return mac.replace(/:/g, '').toLowerCase();
  }

  getSourceIp(targetIp) {
    const interfaces = os.networkInterfaces();
    const targetOctets = targetIp.split('.');
    const targetNetwork = `${targetOctets[0]}.${targetOctets[1]}.${targetOctets[2]}`;

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          const ifaceOctets = iface.address.split('.');
          const ifaceNetwork = `${ifaceOctets[0]}.${ifaceOctets[1]}.${ifaceOctets[2]}`;
          if (ifaceNetwork === targetNetwork) {
            return iface.address;
          }
        }
      }
    }

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }

    return null;
  }

  async start(targetIp) {
    if (this.running) {
      logger.warn('Push manager already running');
      return true;
    }

    this.phoneIp = this.getSourceIp(targetIp);
    if (!this.phoneIp) {
      logger.error('Could not determine source IP');
      return false;
    }

    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket('udp4');

      this.socket.on('error', (err) => {
        logger.error('Push manager socket error:', err);
        reject(err);
      });

      this.socket.on('message', (msg, rinfo) => {
        this.handleMessage(msg, rinfo);
      });

      this.socket.bind(LISTEN_PORT, () => {
        this.running = true;
        logger.info(`Push manager listening on port ${LISTEN_PORT}`);
        logger.verbose(`Phone IP: ${this.phoneIp}, MAC: ${this.phoneMac}`);
        
        // Also listen for firstBeat broadcasts on port 38899
        this.startBroadcastListener();
        
        resolve(true);
      });
    });
  }

  startBroadcastListener() {
    this.broadcastSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.broadcastSocket.on('error', (err) => {
      logger.error('Broadcast socket error:', err);
    });

    this.broadcastSocket.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        const method = data.method;
        const params = data.params || {};
        const mac = params.mac;

        if (method === 'firstBeat' && mac) {
          logger.info(`firstBeat received from ${rinfo.address} (${mac})`);
          this.emit('firstBeat', rinfo.address, mac, params);
        }
      } catch (error) {
        // Ignore parse errors from non-JSON broadcasts
      }
    });

    this.broadcastSocket.bind(RESPOND_PORT, () => {
      logger.info(`Broadcast listener on port ${RESPOND_PORT} for firstBeat`);
    });
  }

  handleMessage(msg, rinfo) {
    try {
      const data = JSON.parse(msg.toString());
      const method = data.method;
      const params = data.params || {};
      const mac = params.mac;

      logger.trace(`Push update from ${rinfo.address}: ${method} (${mac})`);
      logger.trace(JSON.stringify(data, null, 2));

      if (method === 'syncPilot' && mac) {
        // Mark light as online if it was offline
        if (this.offlineLights.has(mac)) {
          this.offlineLights.delete(mac);
          logger.info(`Light ${mac} (${rinfo.address}) is back online`);
        }
        
        const callback = this.subscriptions.get(mac);
        if (callback) {
          callback(params, rinfo);
        }
      } else if (method === 'firstBeat' && mac) {
        logger.info(`New device discovered: ${rinfo.address} (${mac})`);
        this.emit('firstBeat', rinfo.address, mac, params);
      } else if (method === 'registration' && data.result) {
        logger.verbose(`Registration ${data.result.success ? 'successful' : 'failed'} for ${data.result.mac}`);
      }
    } catch (error) {
      logger.error('Error parsing push message:', error);
      logger.trace('Raw message:', msg.toString());
    }
  }

  async register(lightIp, lightMac, enableKeepAlive = false) {
    if (!this.running) {
      throw new Error('Push manager not started');
    }

    const registrationMsg = {
      params: {
        phoneIp: this.phoneIp,
        register: true,
        phoneMac: this.phoneMac
      },
      method: 'registration'
    };

    return new Promise((resolve, reject) => {
      const message = Buffer.from(JSON.stringify(registrationMsg));
      
      logger.trace(`Sending registration to ${lightIp}:`, JSON.stringify(registrationMsg));
      
      this.socket.send(message, RESPOND_PORT, lightIp, (error) => {
        if (error) {
          logger.error(`Failed to register with ${lightIp}:`, error);
          reject(error);
          return;
        }

        logger.verbose(`Registered with light ${lightIp} (${lightMac})`);
        this.registeredLights.add(lightMac);

        if (enableKeepAlive) {
          if (this.keepAliveTimers.has(lightMac)) {
            clearInterval(this.keepAliveTimers.get(lightMac));
          }

          const keepAliveTimer = setInterval(() => {
            // Skip if light is offline
            if (this.offlineLights.has(lightMac)) {
              logger.trace(`Skipping keep-alive for offline light ${lightMac}`);
              return;
            }
            
            this.socket.send(message, RESPOND_PORT, lightIp, (err) => {
              if (err) {
                if (err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH') {
                  // Mark light as offline to stop sending
                  this.offlineLights.add(lightMac);
                  logger.warn(`Light ${lightMac} (${lightIp}) marked offline - will resume on syncPilot response`);
                } else {
                  logger.error(`Keep-alive failed for ${lightIp}:`, err);
                }
              } else {
                logger.trace(`Keep-alive sent to ${lightIp}`);
              }
            });
          }, KEEP_ALIVE_INTERVAL);

          this.keepAliveTimers.set(lightMac, keepAliveTimer);
          logger.verbose(`Keep-alive enabled for ${lightMac} (every ${KEEP_ALIVE_INTERVAL / 1000}s)`);
        }

        resolve();
      });
    });
  }

  enableKeepAlive(lightIp, lightMac) {
    if (this.keepAliveTimers.has(lightMac)) {
      return;
    }

    const registrationMsg = {
      params: {
        phoneIp: this.phoneIp,
        register: true,
        phoneMac: this.phoneMac
      },
      method: 'registration'
    };

    const message = Buffer.from(JSON.stringify(registrationMsg));
    
    const keepAliveTimer = setInterval(() => {
      // Skip if light is offline
      if (this.offlineLights.has(lightMac)) {
        logger.trace(`Skipping keep-alive for offline light ${lightMac}`);
        return;
      }
      
      this.socket.send(message, RESPOND_PORT, lightIp, (err) => {
        if (err) {
          if (err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH') {
            // Mark light as offline to stop sending
            this.offlineLights.add(lightMac);
            logger.warn(`Light ${lightMac} (${lightIp}) marked offline - will resume on syncPilot response`);
          } else {
            logger.error(`Keep-alive failed for ${lightIp}:`, err);
          }
        } else {
          logger.trace(`Keep-alive sent to ${lightIp}`);
        }
      });
    }, KEEP_ALIVE_INTERVAL);

    this.keepAliveTimers.set(lightMac, keepAliveTimer);
    logger.verbose(`Keep-alive enabled for ${lightMac}`);
  }

  disableKeepAlive(lightMac) {
    if (this.keepAliveTimers.has(lightMac)) {
      clearInterval(this.keepAliveTimers.get(lightMac));
      this.keepAliveTimers.delete(lightMac);
      logger.verbose(`Keep-alive disabled for ${lightMac}`);
    }
  }

  enableAllKeepAlive() {
    logger.verbose('Enabling keep-alive for all registered lights');
  }

  disableAllKeepAlive() {
    for (const [mac, timer] of this.keepAliveTimers.entries()) {
      clearInterval(timer);
      logger.trace(`Disabled keep-alive for ${mac}`);
    }
    this.keepAliveTimers.clear();
    logger.verbose('All keep-alive timers disabled');
  }

  subscribe(mac, callback) {
    this.subscriptions.set(mac, callback);
    logger.verbose(`Subscribed to updates for ${mac}`);

    return () => {
      this.subscriptions.delete(mac);
      logger.verbose(`Unsubscribed from ${mac}`);
    };
  }

  unsubscribe(mac) {
    const removed = this.subscriptions.delete(mac);
    if (removed) {
      logger.verbose(`Unsubscribed from ${mac}`);
    }
    return removed;
  }

  async stop() {
    if (!this.running) {
      return;
    }

    for (const timer of this.keepAliveTimers.values()) {
      clearInterval(timer);
    }
    this.keepAliveTimers.clear();

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    if (this.broadcastSocket) {
      this.broadcastSocket.close();
      this.broadcastSocket = null;
    }

    this.running = false;
    this.syncEnabled = false;
    this.registeredLights.clear();
    this.subscriptions.clear();
    logger.info('Push manager stopped');
  }
}

module.exports = PushManager;
