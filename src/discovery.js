const dgram = require('dgram');

class WizDiscovery {
  constructor(port = 38899, timeout = 3000) {
    this.port = port;
    this.timeout = timeout;
  }

  async discoverLights(broadcastAddress = '255.255.255.255') {
    return new Promise((resolve, reject) => {
      const client = dgram.createSocket('udp4');
      const discoveredLights = [];
      const seenMacs = new Set();

      client.on('error', (err) => {
        client.close();
        reject(err);
      });

      client.on('message', (msg, rinfo) => {
        try {
          const response = JSON.parse(msg.toString());
          
          if (response.result && response.result.mac) {
            const mac = response.result.mac;
            
            if (!seenMacs.has(mac)) {
              seenMacs.add(mac);
              
              const lightInfo = {
                ip: rinfo.address,
                mac: mac,
                port: this.port,
                state: response.result.state || false,
                rssi: response.result.rssi || null,
                temp: response.result.temp || null,
                dimming: response.result.dimming || null,
                sceneId: response.result.sceneId || null
              };
              
              discoveredLights.push(lightInfo);
              console.log(`✓ Found light: ${rinfo.address} (MAC: ${mac})`);
            }
          }
        } catch (error) {
          console.error(`Error parsing response from ${rinfo.address}:`, error.message);
        }
      });

      client.bind(() => {
        client.setBroadcast(true);
        
        const payload = {
          method: 'getPilot',
          params: {}
        };
        
        const message = Buffer.from(JSON.stringify(payload));
        
        client.send(message, this.port, broadcastAddress, (error) => {
          if (error) {
            client.close();
            reject(error);
            return;
          }
          
          console.log(`Broadcasting discovery to ${broadcastAddress}:${this.port}...`);
          
          setTimeout(() => {
            client.close();
            resolve(discoveredLights);
          }, this.timeout);
        });
      });
    });
  }

  async discoverOnSubnet(subnet = '192.168.1') {
    console.log(`Scanning subnet ${subnet}.0/24...`);
    const discoveredLights = [];
    const seenMacs = new Set();

    const scanPromises = [];
    
    for (let i = 1; i <= 254; i++) {
      const ip = `${subnet}.${i}`;
      scanPromises.push(this.probeSingleIP(ip));
    }

    const results = await Promise.allSettled(scanPromises);
    
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value) {
        const lightInfo = result.value;
        if (!seenMacs.has(lightInfo.mac)) {
          seenMacs.add(lightInfo.mac);
          discoveredLights.push(lightInfo);
          console.log(`✓ Found light: ${lightInfo.ip} (MAC: ${lightInfo.mac})`);
        }
      }
    });

    return discoveredLights;
  }

  async probeSingleIP(ip) {
    return new Promise((resolve) => {
      const client = dgram.createSocket('udp4');
      
      const timer = setTimeout(() => {
        client.close();
        resolve(null);
      }, 1000);

      client.on('message', (msg, rinfo) => {
        clearTimeout(timer);
        client.close();
        
        try {
          const response = JSON.parse(msg.toString());
          
          if (response.result && response.result.mac) {
            resolve({
              ip: rinfo.address,
              mac: response.result.mac,
              port: this.port,
              state: response.result.state || false,
              rssi: response.result.rssi || null,
              temp: response.result.temp || null,
              dimming: response.result.dimming || null,
              sceneId: response.result.sceneId || null
            });
          } else {
            resolve(null);
          }
        } catch (error) {
          resolve(null);
        }
      });

      client.on('error', () => {
        clearTimeout(timer);
        client.close();
        resolve(null);
      });

      const payload = {
        method: 'getPilot',
        params: {}
      };
      
      const message = Buffer.from(JSON.stringify(payload));
      
      client.send(message, this.port, ip, (error) => {
        if (error) {
          clearTimeout(timer);
          client.close();
          resolve(null);
        }
      });
    });
  }
}

module.exports = WizDiscovery;
