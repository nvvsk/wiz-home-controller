const WizDiscovery = require('./src/discovery');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('🔍 WiZ Light Discovery Tool\n');
  
  const discovery = new WizDiscovery();
  
  const method = process.argv[2] || 'broadcast';
  const subnet = process.argv[3] || '192.168.1';
  
  let lights = [];
  
  if (method === 'subnet') {
    console.log(`Using subnet scan method on ${subnet}.0/24\n`);
    lights = await discovery.discoverOnSubnet(subnet);
  } else {
    console.log('Using broadcast discovery method\n');
    lights = await discovery.discoverLights();
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`Discovery complete! Found ${lights.length} light(s)`);
  console.log('='.repeat(60) + '\n');
  
  if (lights.length === 0) {
    console.log('❌ No WiZ lights found on the network.');
    console.log('\nTroubleshooting:');
    console.log('1. Make sure your WiZ lights are powered on');
    console.log('2. Ensure lights are connected to the same network');
    console.log('3. Try subnet scan: node discover.js subnet 192.168.1');
    console.log('4. Check your router for the light IP addresses\n');
    return;
  }
  
  lights.forEach((light, index) => {
    console.log(`Light ${index + 1}:`);
    console.log(`  IP Address: ${light.ip}`);
    console.log(`  MAC Address: ${light.mac}`);
    console.log(`  State: ${light.state ? 'ON' : 'OFF'}`);
    console.log(`  Signal Strength: ${light.rssi} dBm`);
    if (light.temp) console.log(`  Color Temp: ${light.temp}K`);
    if (light.dimming) console.log(`  Brightness: ${light.dimming}%`);
    console.log('');
  });
  
  const saveConfig = process.argv.includes('--save');
  
  if (saveConfig) {
    const configPath = path.join(__dirname, 'config', 'lights.json');
    
    const config = {
      lights: lights.map((light, index) => ({
        id: `light${index + 1}`,
        name: `WiZ Light ${index + 1}`,
        ip: light.ip,
        mac: light.mac,
        groups: ['all']
      })),
      groups: [
        {
          id: 'all',
          name: 'All Lights',
          description: 'All lights in the house'
        }
      ]
    };
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`✅ Configuration saved to ${configPath}\n`);
    console.log('You can now run: npm test\n');
  } else {
    console.log('💡 Tip: Run with --save to automatically update config/lights.json');
    console.log('   Example: node discover.js --save\n');
  }
}

main().catch(error => {
  console.error('❌ Discovery failed:', error.message);
  process.exit(1);
});
