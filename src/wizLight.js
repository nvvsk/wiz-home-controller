const dgram = require('dgram');

class WizLight {
  constructor(ip, port = 38899) {
    this.ip = ip;
    this.port = port;
    this.timeout = 5000;
  }

  async sendCommand(payload) {
    return new Promise((resolve, reject) => {
      const client = dgram.createSocket('udp4');
      const message = Buffer.from(JSON.stringify(payload));
      
      const timer = setTimeout(() => {
        client.close();
        reject(new Error(`Timeout: No response from ${this.ip}`));
      }, this.timeout);

      client.on('message', (msg) => {
        clearTimeout(timer);
        client.close();
        try {
          const response = JSON.parse(msg.toString());
          resolve(response);
        } catch (error) {
          reject(new Error(`Invalid JSON response: ${msg.toString()}`));
        }
      });

      client.on('error', (error) => {
        clearTimeout(timer);
        client.close();
        reject(error);
      });

      client.send(message, this.port, this.ip, (error) => {
        if (error) {
          clearTimeout(timer);
          client.close();
          reject(error);
        }
      });
    });
  }

  async turnOn() {
    const payload = {
      id: 1,
      method: 'setState',
      params: { state: true }
    };
    return await this.sendCommand(payload);
  }

  async turnOff() {
    const payload = {
      id: 1,
      method: 'setState',
      params: { state: false }
    };
    return await this.sendCommand(payload);
  }

  async setBrightness(brightness) {
    if (brightness < 10 || brightness > 100) {
      throw new Error('Brightness must be between 10 and 100');
    }
    const payload = {
      id: 1,
      method: 'setPilot',
      params: { dimming: brightness }
    };
    return await this.sendCommand(payload);
  }

  async setColorTemp(temp, brightness = null) {
    if (temp < 2200 || temp > 6500) {
      throw new Error('Color temperature must be between 2200K and 6500K');
    }
    const params = { temp };
    if (brightness !== null) {
      if (brightness < 10 || brightness > 100) {
        throw new Error('Brightness must be between 10 and 100');
      }
      params.dimming = brightness;
    }
    const payload = {
      id: 1,
      method: 'setPilot',
      params
    };
    return await this.sendCommand(payload);
  }

  async getStatus() {
    const payload = {
      method: 'getPilot',
      params: {}
    };
    return await this.sendCommand(payload);
  }

  async setScene(sceneId) {
    const payload = {
      id: 1,
      method: 'setPilot',
      params: { sceneId }
    };
    return await this.sendCommand(payload);
  }

  async setRGB(r, g, b, brightness = null) {
    if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) {
      throw new Error('RGB values must be between 0 and 255');
    }
    const params = { r, g, b };
    if (brightness !== null) {
      if (brightness < 10 || brightness > 100) {
        throw new Error('Brightness must be between 10 and 100');
      }
      params.dimming = brightness;
    }
    const payload = {
      id: 1,
      method: 'setPilot',
      params
    };
    return await this.sendCommand(payload);
  }
}

module.exports = WizLight;
