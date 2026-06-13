const API_URL = 'http://localhost:3000';
let socket = null;
let discoveredDevices = [];
let configuredDevices = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();
  loadStats();
  loadDiscoveredDevices();
  loadConfiguredDevices();
});

// WebSocket Connection
function connectWebSocket() {
  socket = io(API_URL);

  socket.on('connect', () => {
    updateConnectionStatus(true);
    console.log('Connected to server');
  });

  socket.on('disconnect', () => {
    updateConnectionStatus(false);
    console.log('Disconnected from server');
  });

  socket.on('device:discovered', (device) => {
    console.log('New device discovered:', device);
    discoveredDevices.push(device);
    renderDiscoveredDevices();
    updateStats();
    showNotification(`New device found: ${device.ip}`, 'info');
  });

  socket.on('device:added', (device) => {
    console.log('Device added:', device);
    loadDiscoveredDevices();
    loadConfiguredDevices();
    loadStats();
    showNotification(`Device added: ${device.name}`, 'success');
  });

  socket.on('devices:added', (data) => {
    console.log('Devices added:', data);
    loadDiscoveredDevices();
    loadConfiguredDevices();
    loadStats();
    showNotification(`${data.count} devices added`, 'success');
  });

  socket.on('device:removed', (data) => {
    console.log('Device removed:', data);
    loadConfiguredDevices();
    loadStats();
    showNotification('Device removed', 'success');
  });

  socket.on('device:ignored', (data) => {
    console.log('Device ignored:', data);
    loadDiscoveredDevices();
    updateStats();
  });

  socket.on('devices:cleared', () => {
    console.log('Discovered devices cleared');
    loadDiscoveredDevices();
    updateStats();
    showNotification('Discovered devices cleared', 'success');
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

// Load Stats
async function loadStats() {
  try {
    const response = await fetch(`${API_URL}/api/devices/stats`);
    const stats = await response.json();
    updateStats(stats);
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

function updateStats(stats = null) {
  const configured = stats?.configured || configuredDevices.length;
  const discovered = stats?.discovered || discoveredDevices.length;
  const total = configured + discovered;

  document.getElementById('configuredCount').textContent = configured;
  document.getElementById('discoveredCount').textContent = discovered;
  document.getElementById('totalCount').textContent = total;
}

// Load Discovered Devices
async function loadDiscoveredDevices() {
  try {
    const response = await fetch(`${API_URL}/api/devices/discovered`);
    const data = await response.json();
    discoveredDevices = data.devices;
    renderDiscoveredDevices();
    updateStats();
  } catch (error) {
    console.error('Failed to load discovered devices:', error);
  }
}

// Load Configured Devices
async function loadConfiguredDevices() {
  try {
    const response = await fetch(`${API_URL}/api/devices/configured`);
    const data = await response.json();
    configuredDevices = data.devices;
    renderConfiguredDevices();
    updateStats();
  } catch (error) {
    console.error('Failed to load configured devices:', error);
  }
}

// Render Discovered Devices
function renderDiscoveredDevices() {
  const container = document.getElementById('discoveredDevices');
  
  if (discoveredDevices.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-gray-500">
        <i class="fas fa-search text-4xl mb-3 text-gray-300"></i>
        <p>No new devices discovered</p>
        <p class="text-sm mt-1">New WiZ lights will appear here automatically</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <table class="min-w-full divide-y divide-gray-200">
      <thead class="bg-gray-50">
        <tr>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Device</th>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP Address</th>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">MAC Address</th>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Discovered</th>
          <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
        </tr>
      </thead>
      <tbody class="bg-white divide-y divide-gray-200">
        ${discoveredDevices.map(device => `
          <tr class="hover:bg-gray-50">
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="flex items-center">
                <i class="fas fa-lightbulb text-yellow-500 mr-3"></i>
                <div>
                  <div class="text-sm font-medium text-gray-900">WiZ Light</div>
                  <div class="text-xs text-gray-500">${device.id}</div>
                </div>
              </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${device.ip}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500">${device.mac}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${new Date(device.discoveredAt).toLocaleString()}</td>
            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
              <button onclick="addDevice('${device.id}')" class="text-blue-600 hover:text-blue-900 mr-3">
                <i class="fas fa-plus-circle mr-1"></i>Add
              </button>
              <button onclick="ignoreDevice('${device.id}')" class="text-gray-600 hover:text-gray-900">
                <i class="fas fa-times-circle mr-1"></i>Ignore
              </button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// Render Configured Devices
function renderConfiguredDevices() {
  const container = document.getElementById('configuredDevices');
  
  if (configuredDevices.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-gray-500">
        <i class="fas fa-lightbulb text-4xl mb-3 text-gray-300"></i>
        <p>No devices configured</p>
        <p class="text-sm mt-1">Add devices from the discovered list above</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <table class="min-w-full divide-y divide-gray-200">
      <thead class="bg-gray-50">
        <tr>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Device</th>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP Address</th>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">MAC Address</th>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Groups</th>
          <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
        </tr>
      </thead>
      <tbody class="bg-white divide-y divide-gray-200">
        ${configuredDevices.map(device => `
          <tr class="hover:bg-gray-50">
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="flex items-center">
                <i class="fas fa-lightbulb text-green-500 mr-3"></i>
                <div>
                  <div class="text-sm font-medium text-gray-900">${device.name}</div>
                  <div class="text-xs text-gray-500">${device.id}</div>
                </div>
              </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${device.ip}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500">${device.mac}</td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="flex flex-wrap gap-1">
                ${device.groups.map(group => `
                  <span class="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">${group}</span>
                `).join('')}
              </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
              <button onclick="removeDevice('${device.id}', '${device.name}')" class="text-red-600 hover:text-red-900">
                <i class="fas fa-trash mr-1"></i>Remove
              </button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// Device Actions
async function addDevice(deviceId) {
  const device = discoveredDevices.find(d => d.id === deviceId);
  const autoName = device ? `WiZ Light ${device.mac.slice(-4)}` : '';
  
  const name = prompt(`Enter a name for this device (or leave empty for auto-name: "${autoName}"):`, '');
  if (name === null) return; // User cancelled

  try {
    const response = await fetch(`${API_URL}/api/devices/discovered/${deviceId}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() || undefined })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error);
    }
    
    const data = await response.json();
    console.log('Device added:', data);
  } catch (error) {
    console.error('Failed to add device:', error);
    alert(`Failed to add device: ${error.message}`);
  }
}

async function addAllDiscovered() {
  if (discoveredDevices.length === 0) {
    alert('No devices to add');
    return;
  }

  if (!confirm(`Add all ${discoveredDevices.length} discovered devices?`)) {
    return;
  }

  try {
    const response = await fetch(`${API_URL}/api/devices/discovered/add-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    console.log('All devices added:', data);
  } catch (error) {
    console.error('Failed to add all devices:', error);
    alert('Failed to add devices');
  }
}

async function ignoreDevice(deviceId) {
  try {
    await fetch(`${API_URL}/api/devices/discovered/${deviceId}`, {
      method: 'DELETE'
    });
  } catch (error) {
    console.error('Failed to ignore device:', error);
  }
}

async function clearDiscovered() {
  if (discoveredDevices.length === 0) {
    alert('No devices to clear');
    return;
  }

  if (!confirm('Clear all discovered devices?')) {
    return;
  }

  try {
    await fetch(`${API_URL}/api/devices/discovered`, {
      method: 'DELETE'
    });
  } catch (error) {
    console.error('Failed to clear devices:', error);
  }
}

async function removeDevice(deviceId, deviceName) {
  if (!confirm(`Remove "${deviceName}" from configuration?`)) {
    return;
  }

  try {
    await fetch(`${API_URL}/api/devices/configured/${deviceId}`, {
      method: 'DELETE'
    });
  } catch (error) {
    console.error('Failed to remove device:', error);
    alert('Failed to remove device');
  }
}

// Manual Network Scan
async function scanNetwork() {
  showNotification('Scanning network for WiZ devices...', 'info');
  
  try {
    const response = await fetch(`${API_URL}/api/devices/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    console.log('Scan result:', data);
    
    if (data.devices && data.devices.length > 0) {
      // Add discovered devices to the list
      for (const device of data.devices) {
        const deviceId = device.mac.toLowerCase().replace(/:/g, '');
        
        // Check if already in discovered or configured
        const alreadyDiscovered = discoveredDevices.some(d => d.id === deviceId);
        const alreadyConfigured = configuredDevices.some(d => d.id === deviceId || d.mac === deviceId);
        
        if (!alreadyDiscovered && !alreadyConfigured) {
          const newDevice = {
            id: deviceId,
            ip: device.ip,
            mac: deviceId,
            modelConfig: device.modelConfig || {},
            discoveredAt: new Date().toISOString(),
            source: 'scan'
          };
          
          discoveredDevices.push(newDevice);
        }
      }
      
      renderDiscoveredDevices();
      updateStats();
      showNotification(`Found ${data.devices.length} devices`, 'success');
    } else {
      showNotification('No new devices found', 'info');
    }
  } catch (error) {
    console.error('Scan failed:', error);
    showNotification('Network scan failed', 'error');
  }
}

// Notifications
function showNotification(message, type = 'info') {
  const colors = {
    info: 'bg-blue-500',
    success: 'bg-green-500',
    error: 'bg-red-500'
  };

  const notification = document.createElement('div');
  notification.className = `fixed bottom-4 right-4 ${colors[type]} text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in`;
  notification.innerHTML = `
    <div class="flex items-center space-x-2">
      <i class="fas fa-${type === 'success' ? 'check' : type === 'error' ? 'exclamation' : 'info'}-circle"></i>
      <span>${message}</span>
    </div>
  `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}
