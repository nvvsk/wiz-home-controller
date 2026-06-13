const WizDiscovery = require('../src/discovery');
const PushManager = require('../src/pushManager');

async function main() {
  console.log('🚀 WiZ Push Updates Test\n');

  const discovery = new WizDiscovery();
  console.log('🔍 Discovering lights...\n');
  
  const lights = await discovery.discoverLights();
  
  if (lights.length === 0) {
    console.log('❌ No lights found. Make sure lights are on and connected.');
    process.exit(1);
  }

  console.log(`\n✓ Found ${lights.length} light(s)\n`);
  lights.forEach((light, idx) => {
    console.log(`  ${idx + 1}. ${light.ip} (${light.mac})`);
  });

  const pushManager = new PushManager();
  
  console.log('\n📡 Starting push manager...\n');
  const started = await pushManager.start(lights[0].ip);
  
  if (!started) {
    console.log('❌ Failed to start push manager');
    process.exit(1);
  }

  console.log('\n📝 Registering lights for push updates...\n');
  
  const enableKeepAlive = process.argv.includes('--keep-alive');
  
  if (enableKeepAlive) {
    console.log('🔄 Keep-alive mode: ENABLED (simulating active UI)');
  } else {
    console.log('💤 Keep-alive mode: DISABLED (one-time registration)');
  }
  console.log('');
  
  for (const light of lights) {
    const unsubscribe = pushManager.subscribe(light.mac, (params, rinfo) => {
      console.log(`\n🔄 State change detected for ${light.mac}:`);
      console.log(`   IP: ${rinfo.address}`);
      console.log(`   State: ${params.state ? 'ON' : 'OFF'}`);
      if (params.dimming) console.log(`   Brightness: ${params.dimming}%`);
      if (params.temp) console.log(`   Color Temp: ${params.temp}K`);
      if (params.r !== undefined) {
        console.log(`   RGB: (${params.r}, ${params.g}, ${params.b})`);
      }
      if (params.sceneId) console.log(`   Scene: ${params.sceneId}`);
    });

    await pushManager.register(light.ip, light.mac, enableKeepAlive);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ All lights registered!');
  console.log('='.repeat(60));
  console.log('\n👀 Listening for push updates...');
  console.log('💡 Try controlling lights with the WiZ app or physical switch');
  if (!enableKeepAlive) {
    console.log('\n💡 Tip: Run with --keep-alive to enable continuous registration');
    console.log('   (simulates active UI session)');
  }
  console.log('🛑 Press Ctrl+C to stop\n');

  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down...');
    await pushManager.stop();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
