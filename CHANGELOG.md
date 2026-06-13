# Changelog

All notable changes to the WiZ Home Controller project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Sprint 2 - REST API Layer (In Progress)
- Push updates via syncPilot ✅
- Express REST API (Pending)
- WebSocket integration (Pending)
- Web dashboard (Pending)

---

## [0.1.0] - 2026-05-31

### Added - Sprint 1 Complete ✅

#### Core Features
- **UDP Communication Module** (`src/wizLight.js`)
  - Turn lights on/off
  - Set brightness (10-100%)
  - Set color temperature (2200K-6500K)
  - Set RGB colors (0-255 per channel)
  - Get current light status
  - Scene support

- **Automatic Light Discovery** (`src/discovery.js`)
  - UDP broadcast discovery (255.255.255.255)
  - Subnet scanning fallback
  - Automatic light detection and configuration

- **Push Updates System** (`src/pushManager.js`)
  - syncPilot real-time state updates
  - UDP listener on port 38900
  - Registration with lights (one-time + keep-alive modes)
  - Multi-source detection (heartbeat, UDP, Alexa, etc.)
  - Smart keep-alive management (UI-driven)

#### Testing & Tools
- CLI test suite for UDP commands (`tests/test-cli.js`)
- Push update testing tool (`tests/test-push.js`)
- Discovery CLI tool (`discover.js`)
- Configuration management (`config/lights.json`)

#### Documentation
- Project plan with sprint breakdown (`PROJECT_PLAN.md`)
- Comprehensive README with API documentation
- NPM scripts for common tasks

### Testing Results
- ✅ Successfully tested with 9 WiZ lights
- ✅ All UDP commands working (on/off, brightness, color temp, RGB)
- ✅ Discovery working via broadcast method
- ✅ Push updates receiving real-time state changes
- ✅ Detected multiple sources: heartbeat (hb), UDP commands, Alexa (alexad)

### Technical Details
- **Protocol**: Unencrypted JSON over UDP (port 38899)
- **Push Listener**: UDP port 38900
- **MAC Format**: Lowercase without colons (e.g., `d8a01182b255`)
- **Network Detection**: Automatic source IP detection based on light subnet

---

## Session Log

### 2026-05-31 00:58 - End of Day
- Sprint 1 complete and tested
- syncPilot push updates working perfectly
- Ready to begin Express REST API implementation
- All code organized and documented

### 2026-05-31 00:57 - syncPilot Success
- Real-time state changes from all 9 lights working
- Heartbeat messages every ~5 seconds
- Detected sources: udp, hb (heartbeat), alexad (Alexa)
- Keep-alive registration successful
- Ready for Express/WebSocket integration

### 2026-05-31 00:38 - Architecture Planning
- Sprint 2 architecture planned with authentication in mind
- Middleware structure to support future JWT/API key auth
- Added Sprint 6 for Authentication & Security

### 2026-05-31 00:35 - Sprint 1 Complete
- Successfully tested with 9 WiZ lights
- All UDP commands working (on/off, brightness, color temp, RGB)
- Discovery working (broadcast method)
- Ready to begin Sprint 2

### 2026-05-31 00:32 - New Requirements
- Custom light naming tied to MAC address
- Signal strength display based on RSSI values
- Push updates via `syncPilot` for real-time state changes
- Added to Sprint 2 objectives

### 2026-05-31 00:12 - Discovery Feature
- Added automatic light discovery feature
- Broadcast discovery (255.255.255.255)
- Subnet scanning fallback
- Auto-save discovered lights to config

### 2026-05-31 00:09 - Project Initialization
- Project renamed to "WiZ Home Controller"
- Initial UDP communication module created
- Basic project structure established

---

## Next Release - [0.2.0] (Planned)

### Sprint 2 - REST API Layer

#### Planned Features
- Express server with middleware architecture
- REST API endpoints:
  - `GET /api/lights` - List all lights
  - `GET /api/lights/:id` - Get light details
  - `POST /api/lights/:id/on` - Turn on
  - `POST /api/lights/:id/off` - Turn off
  - `PUT /api/lights/:id/brightness` - Set brightness
  - `PUT /api/lights/:id/temperature` - Set color temp
  - `PUT /api/lights/:id/name` - Rename light (MAC-based)
- WebSocket integration (Socket.io)
- Light configuration management
  - Custom naming tied to MAC address
  - RSSI to signal strength conversion
  - Group management
- Auth-ready middleware for future JWT/API key support

---

## Future Releases

### [0.3.0] - Sprint 3: Web Dashboard
- React-based web interface
- Real-time light control
- Live status updates via WebSocket
- Group management UI

### [0.4.0] - Sprint 4: Automation Engine
- Time-based automation
- Sunrise/sunset triggers
- Scene scheduling
- Rule engine

### [0.5.0] - Sprint 5: Automation UI
- Visual rule builder
- Schedule management interface
- Scene management

### [1.0.0] - Sprint 6: Authentication & Security
- JWT-based authentication
- API key support
- User management
- Rate limiting
- HTTPS/TLS support
