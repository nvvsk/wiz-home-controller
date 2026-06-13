const WizLight = require('../src/wizLight');
const config = require('../config/lights.json');

async function testLight(lightConfig) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Testing: ${lightConfig.name} (${lightConfig.ip})`);
  console.log('='.repeat(50));

  const light = new WizLight(lightConfig.ip, lightConfig.port || 38899);

  try {
    console.log('\n1. Getting current status...');
    const status = await light.getStatus();
    console.log('Status:', JSON.stringify(status, null, 2));
    await sleep(5000);

    console.log('\n2. Turning light ON...');
    await light.turnOn();
    await sleep(1000);
    const statusAfterOn = await light.getStatus();
    console.log('Current state:', JSON.stringify(statusAfterOn.result, null, 2));
    await sleep(5000);

    console.log('\n3. Setting brightness to 25%...');
    await light.setBrightness(25);
    await sleep(1000);
    const statusAfterBrightness = await light.getStatus();
    console.log('Current state:', JSON.stringify(statusAfterBrightness.result, null, 2));
    await sleep(5000);

    console.log('\n4. Setting color temperature to 3000K with 100% brightness...');
    await light.setColorTemp(3000, 100);
    await sleep(1000);
    const statusAfterTemp = await light.getStatus();
    console.log('Current state:', JSON.stringify(statusAfterTemp.result, null, 2));
    await sleep(5000);

    console.log('\n5. Setting RGB color (255, 0, 0) - Red...');
    await light.setRGB(255, 0, 0, 75);
    await sleep(1000);
    const statusAfterRGB = await light.getStatus();
    console.log('Current state:', JSON.stringify(statusAfterRGB.result, null, 2));
    await sleep(5000);

    console.log('\n6. Turning light OFF...');
    await light.turnOff();
    await sleep(1000);
    const statusAfterOff = await light.getStatus();
    console.log('Current state:', JSON.stringify(statusAfterOff.result, null, 2));
    
    if (statusAfterOff.result.state === false) {
      console.log('\n✅ All tests passed for', lightConfig.name, '- Light turned OFF successfully');
    } else {
      console.log('\n⚠️  Warning:', lightConfig.name, '- Light did not turn OFF');
    }
  } catch (error) {
    console.error('\n❌ Error testing', lightConfig.name, ':', error.message);
  }
}

async function testAllLights() {
  console.log('🚀 Starting WiZ Light UDP Communication Tests');
  console.log('📋 Loaded', config.lights.length, 'light(s) from config\n');

  for (const lightConfig of config.lights) {
    await testLight(lightConfig);
  }

  console.log('\n' + '='.repeat(50));
  console.log('🏁 All tests completed');
  console.log('='.repeat(50));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

if (require.main === module) {
  testAllLights().catch(console.error);
}

module.exports = { testLight, testAllLights };
