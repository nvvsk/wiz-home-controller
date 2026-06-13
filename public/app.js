const API_URL = 'http://localhost:3000';
let socket = null;
let lights = [];
let groups = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();
  loadLights(true); // Fast load - syncPilot will update status
  loadGroups();
  
  // Mark lights as offline if no response within 5 seconds
  setTimeout(() => {
    let updated = false;
    lights.forEach(light => {
      if (!light.status) {
        light.online = false;
        light.status = {}; // Set empty status to trigger offline display
        updated = true;
      }
    });
    if (updated) {
      renderLights();
    }
  }, 5000);
});

// WebSocket Connection
function connectWebSocket() {
  socket = io(API_URL);

  socket.on('connect', () => {
    updateConnectionStatus(true);
    console.log('Connected to server');
    // Enable syncPilot for real-time updates
    enableSyncPilot();
  });

  socket.on('disconnect', () => {
    updateConnectionStatus(false);
    console.log('Disconnected from server');
  });

  socket.on('light:update', (data) => {
    console.log('Light update:', data);
    updateLightCard(data);
  });

  socket.on('light:synced', (data) => {
    console.log('Light synced:', data);
    updateLightCard(data);
  });

  socket.on('light:command', (data) => {
    console.log('Light command:', data);
    // Refresh light status after command
    setTimeout(() => loadLights(), 500);
  });
}

function updateConnectionStatus(connected) {
  const statusEl = document.getElementById('connectionStatus');
  if (connected) {
    statusEl.innerHTML = `
      <div class="w-3 h-3 rounded-full bg-green-500"></div>
      <span class="text-sm text-gray-600">Connected</span>
    `;
  } else {
    statusEl.innerHTML = `
      <div class="w-3 h-3 rounded-full bg-red-500"></div>
      <span class="text-sm text-gray-600">Disconnected</span>
    `;
  }
}

// Load Lights
async function loadLights(fast = false) {
  try {
    const url = fast ? `${API_URL}/api/lights?fast=true` : `${API_URL}/api/lights`;
    const response = await fetch(url);
    const data = await response.json();
    lights = data.lights;
    renderLights();
  } catch (error) {
    console.error('Failed to load lights:', error);
  }
}

// Load Groups
async function loadGroups() {
  try {
    const response = await fetch(`${API_URL}/api/groups`);
    const data = await response.json();
    groups = data.groups;
    renderGroups();
  } catch (error) {
    console.error('Failed to load groups:', error);
  }
}

// Render Lights
function renderLights() {
  const container = document.getElementById('lightsContainer');
  container.innerHTML = lights.map(light => createLightCard(light)).join('');
}

// Render Groups
function renderGroups() {
  const container = document.getElementById('groupsContainer');
  container.innerHTML = groups.map(group => createGroupCard(group)).join('');
}

// Get Signal Strength Badge
function getSignalBadge(rssi) {
  if (!rssi) {
    return `<span class="signal-bars text-gray-400" title="Signal: Unknown">
      <span class="signal-bar signal-bar-1 inactive"></span>
      <span class="signal-bar signal-bar-2 inactive"></span>
      <span class="signal-bar signal-bar-3 inactive"></span>
      <span class="signal-bar signal-bar-4 inactive"></span>
    </span>`;
  }
  
  // RSSI ranges: Excellent > -50, Good > -60, Fair > -70, Weak <= -70
  let color, label, bars;
  
  if (rssi > -50) {
    color = 'text-green-600';
    label = 'Excellent';
    bars = 4;
  } else if (rssi > -60) {
    color = 'text-blue-600';
    label = 'Good';
    bars = 3;
  } else if (rssi > -70) {
    color = 'text-yellow-600';
    label = 'Fair';
    bars = 2;
  } else {
    color = 'text-orange-600';
    label = 'Weak';
    bars = 1;
  }
  
  return `<span class="signal-bars ${color}" title="Signal: ${label} (${rssi} dBm)">
    <span class="signal-bar signal-bar-1 ${bars >= 1 ? '' : 'inactive'}"></span>
    <span class="signal-bar signal-bar-2 ${bars >= 2 ? '' : 'inactive'}"></span>
    <span class="signal-bar signal-bar-3 ${bars >= 3 ? '' : 'inactive'}"></span>
    <span class="signal-bar signal-bar-4 ${bars >= 4 ? '' : 'inactive'}"></span>
  </span>`;
}

// Create Light Card
function createLightCard(light) {
  const hasStatus = light.status !== null && light.status !== undefined;
  const hasValidStatus = hasStatus && (light.status.state !== undefined || light.status.brightness !== undefined);
  const isOn = light.status?.state || false;
  const brightness = light.status?.brightness || 0;
  const temp = light.status?.temperature || 3000;
  const online = light.online !== false;
  
  // If no valid status yet and online, show loading state
  if (!hasValidStatus && online) {
    return `
      <div class="light-card light-off rounded-lg border-2 border-gray-300 p-4" id="light-${light.id}" style="background: linear-gradient(90deg, #f9fafb 0%, #f3f4f6 50%, #f9fafb 100%); background-size: 200% 100%; animation: shimmer 2s infinite;">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center space-x-2">
            <i class="fas fa-lightbulb text-2xl text-gray-400 animate-pulse"></i>
            <div>
              <div class="flex items-center space-x-2">
                <h3 class="font-semibold text-gray-700">${light.name}</h3>
                <button 
                  onclick="renameLight('${light.id}', '${light.name}')"
                  class="text-gray-400 hover:text-gray-600"
                  title="Rename"
                >
                  <i class="fas fa-edit text-sm"></i>
                </button>
              </div>
              <p class="text-xs text-gray-500">${light.ip}</p>
            </div>
          </div>
          <div class="flex items-center space-x-2">
            <div class="flex space-x-1">
              <div class="w-1 h-4 bg-blue-400 rounded animate-pulse" style="animation-delay: 0s"></div>
              <div class="w-1 h-4 bg-blue-400 rounded animate-pulse" style="animation-delay: 0.2s"></div>
              <div class="w-1 h-4 bg-blue-400 rounded animate-pulse" style="animation-delay: 0.4s"></div>
            </div>
          </div>
        </div>
        
        <div class="space-y-3">
          <div class="flex items-center justify-center py-3 bg-gray-100 rounded-lg">
            <i class="fas fa-circle-notch fa-spin text-gray-400 mr-2"></i>
            <span class="text-sm text-gray-500">Connecting...</span>
          </div>
          <div class="space-y-2 opacity-40">
            <div class="flex items-center justify-between">
              <span class="text-xs text-gray-500">Brightness</span>
              <span class="text-xs text-gray-400">--</span>
            </div>
            <div class="h-2 bg-gray-200 rounded-full"></div>
            <div class="flex items-center justify-between">
              <span class="text-xs text-gray-500">Temperature</span>
              <span class="text-xs text-gray-400">--</span>
            </div>
            <div class="h-2 bg-gray-200 rounded-full"></div>
          </div>
        </div>
      </div>
    `;
  }
  
  return `
    <div class="light-card ${isOn ? 'light-on' : 'light-off'} rounded-lg border-2 p-4" id="light-${light.id}">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center space-x-2">
          <i class="fas fa-lightbulb text-2xl ${isOn ? 'text-yellow-600' : 'text-gray-400'}"></i>
          <div>
            <div class="flex items-center space-x-2">
              <h3 class="font-semibold text-gray-900">${light.name}</h3>
              <button 
                onclick="renameLight('${light.id}', '${light.name}')"
                class="text-gray-400 hover:text-gray-600"
                title="Rename"
              >
                <i class="fas fa-edit text-sm"></i>
              </button>
            </div>
            <p class="text-xs text-gray-500">${light.ip}</p>
          </div>
        </div>
        <div class="flex items-center space-x-2">
          ${online ? getSignalBadge(light.status?.rssi) : `
            <span class="text-red-600 text-lg" title="Offline">
              <i class="fas fa-times-circle"></i>
            </span>
          `}
        </div>
      </div>

      ${online ? `
        <!-- Power Toggle -->
        <div class="mb-3">
          <button 
            onclick="toggleLight('${light.id}', ${!isOn})"
            class="w-full py-2 rounded-lg font-medium transition ${isOn ? 'bg-gray-800 text-white hover:bg-gray-700' : 'bg-blue-500 text-white hover:bg-blue-600'}"
          >
            <i class="fas fa-power-off mr-2"></i>${isOn ? 'Turn Off' : 'Turn On'}
          </button>
        </div>

        <!-- Brightness Slider -->
        <div class="mb-3">
          <div class="flex items-center justify-between mb-1">
            <label class="text-sm font-medium text-gray-700">Brightness</label>
            <span class="text-sm text-gray-600">${brightness}%</span>
          </div>
          <input 
            type="range" 
            min="10" 
            max="100" 
            value="${brightness}" 
            class="slider w-full"
            onchange="setBrightness('${light.id}', this.value)"
          >
        </div>

        <!-- Temperature Slider -->
        <div class="mb-3">
          <div class="flex items-center justify-between mb-1">
            <label class="text-sm font-medium text-gray-700">Temperature</label>
            <span class="text-sm text-gray-600">${temp}K</span>
          </div>
          <input 
            type="range" 
            min="2200" 
            max="6500" 
            value="${temp}" 
            class="slider w-full"
            onchange="setTemperature('${light.id}', this.value)"
          >
        </div>

        <!-- Quick Actions -->
        <div class="grid grid-cols-3 gap-2">
          <button 
            onclick="setPreset('${light.id}', 'warm')"
            class="px-3 py-2 text-xs bg-orange-100 text-orange-800 rounded hover:bg-orange-200 transition"
          >
            Warm
          </button>
          <button 
            onclick="setPreset('${light.id}', 'cool')"
            class="px-3 py-2 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200 transition"
          >
            Cool
          </button>
          <button 
            onclick="setPreset('${light.id}', 'daylight')"
            class="px-3 py-2 text-xs bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200 transition"
          >
            Daylight
          </button>
        </div>
      ` : `
        <div class="text-center py-4 text-gray-500">
          <i class="fas fa-exclamation-triangle text-2xl mb-2"></i>
          <p class="text-sm">Light is offline</p>
        </div>
      `}
    </div>
  `;
}

// Create Group Card
function createGroupCard(group) {
  return `
    <div class="bg-white rounded-lg border-2 border-gray-200 p-4 hover:shadow-lg transition">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center space-x-2">
          <i class="fas fa-layer-group text-2xl text-blue-500"></i>
          <div>
            <h3 class="font-semibold text-gray-900">${group.name}</h3>
            <p class="text-xs text-gray-500">${group.count} lights</p>
          </div>
        </div>
      </div>

      <!-- Group Controls -->
      <div class="space-y-2">
        <button 
          onclick="controlGroup('${group.id}', { state: true })"
          class="w-full py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
        >
          <i class="fas fa-power-off mr-2"></i>Turn On
        </button>
        <button 
          onclick="controlGroup('${group.id}', { state: false })"
          class="w-full py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition"
        >
          <i class="fas fa-power-off mr-2"></i>Turn Off
        </button>
        <div class="grid grid-cols-3 gap-2">
          <button 
            onclick="controlGroup('${group.id}', { brightness: 25 })"
            class="px-3 py-2 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200 transition"
          >
            25%
          </button>
          <button 
            onclick="controlGroup('${group.id}', { brightness: 50 })"
            class="px-3 py-2 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200 transition"
          >
            50%
          </button>
          <button 
            onclick="controlGroup('${group.id}', { brightness: 100 })"
            class="px-3 py-2 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200 transition"
          >
            100%
          </button>
        </div>
      </div>
    </div>
  `;
}

// Update Light Card
function updateLightCard(data) {
  const light = lights.find(l => l.id === data.id || l.mac === data.mac);
  if (light) {
    // Handle both formats: nested status object or flat structure
    if (data.status) {
      light.status = data.status;
      light.online = true; // If we got status, it's online
    } else if (data.state !== undefined || data.brightness !== undefined || data.rssi !== undefined) {
      // Flat format from syncPilot
      light.status = {
        state: data.state,
        brightness: data.brightness,
        temperature: data.temperature,
        rgb: data.rgb,
        rssi: data.rssi,
        sceneId: data.sceneId
      };
      light.online = true; // If we got status, it's online
    }
    
    // Only set offline if explicitly stated
    if (data.online === false) {
      light.online = false;
    }
    
    renderLights();
  }
}

// Control Functions
async function toggleLight(id, state) {
  try {
    await fetch(`${API_URL}/api/lights/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state })
    });
  } catch (error) {
    console.error('Failed to toggle light:', error);
  }
}

async function setBrightness(id, brightness) {
  try {
    await fetch(`${API_URL}/api/lights/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brightness: parseInt(brightness) })
    });
  } catch (error) {
    console.error('Failed to set brightness:', error);
  }
}

async function setTemperature(id, temperature) {
  try {
    await fetch(`${API_URL}/api/lights/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ temperature: parseInt(temperature) })
    });
  } catch (error) {
    console.error('Failed to set temperature:', error);
  }
}

async function setPreset(id, preset) {
  const presets = {
    warm: { state: true, temperature: 2700, brightness: 75 },
    cool: { state: true, temperature: 5000, brightness: 75 },
    daylight: { state: true, temperature: 6500, brightness: 100 }
  };

  try {
    await fetch(`${API_URL}/api/lights/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(presets[preset])
    });
  } catch (error) {
    console.error('Failed to set preset:', error);
  }
}

async function controlGroup(id, payload) {
  try {
    await fetch(`${API_URL}/api/groups/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    setTimeout(() => loadLights(), 500);
  } catch (error) {
    console.error('Failed to control group:', error);
  }
}

async function enableSyncPilot() {
  try {
    const response = await fetch(`${API_URL}/api/lights/sync/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json();
    if (data.alreadyEnabled) {
      console.log('syncPilot already enabled');
    } else {
      console.log('syncPilot enabled:', data);
    }
  } catch (error) {
    console.error('Failed to enable syncPilot:', error);
  }
}

async function syncAllLights() {
  try {
    await loadLights();
  } catch (error) {
    console.error('Failed to sync lights:', error);
  }
}

async function renameLight(id, currentName) {
  const newName = prompt('Enter new name:', currentName);
  if (newName && newName.trim() !== '' && newName !== currentName) {
    try {
      await fetch(`${API_URL}/api/lights/${id}/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() })
      });
      await loadLights();
    } catch (error) {
      console.error('Failed to rename light:', error);
      alert('Failed to rename light');
    }
  }
}
