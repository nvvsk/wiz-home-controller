# WiZ Home Controller

A self-hosted controller for Philips WiZ smart lights. Single Node.js + React app
that talks to bulbs directly over UDP on your LAN — no cloud, no account.

## Features

- **Dashboard** — every bulb shown live (state, brightness, signal), tap to toggle, drag a slider to dim
- **Groups** — nested rooms / floors; group sliders show the live average of their lights
- **Scenes** — one-tap presets (Movie, Bedtime, etc.) targeting any mix of groups + individual lights
- **Automations** — scheduled multi-step routines:
  - Triggered by clock time, sunrise/sunset (with offsets), or manual play
  - Each step can target any mix of groups + lights, with its own transition or enforce
  - **Enforce** locks lights to a state during the window — reverts WiZ-app, Alexa, and physical-switch overrides within ~5 s
- **Bulk mode** — multi-select bulbs on the dashboard and apply on/off/brightness/temperature at once
- **Auto-discovery** — bulbs broadcast `firstBeat` on power-up; new devices show up under Devices
- **DHCP-safe** — bulbs' IPs are re-synced automatically whenever a syncPilot/firstBeat arrives from a new source IP
- **Login screen** — single-user, HMAC-signed bearer token, 7-day expiry, auto-logout on expiry
- **Survives restart** — automation state, schedules, suspension flags persisted

## Architecture (60-second tour)

```
                 ┌──────────────────────────────────────────┐
WiZ bulbs <─────►│  pushManager (UDP 38900)                 │
   (UDP 38899)   │           │                              │
                 │           ▼                              │
                 │  StateProxy                              │
                 │   • desired vs actual                    │
                 │   • reconciles drift on enforced lights  │
                 │   • IP auto-sync on every push           │
                 │           │                              │
                 │           ▼                              │
                 │  AutomationEngine                        │
                 │   • per-step FSM (RUNNING/DONE)          │
                 │   • scheduler (15 s tick)                │
                 │   • releasedUntil on Stop                │
                 │           │                              │
                 │           ▼                              │
                 │  Express routes  ◄────── auth middleware │
                 │  Socket.IO       ◄────── handshake check │
                 └──────────────────────────────────────────┘
                                  │
                                  ▼
                        React frontend (Vite)
```

## Quick start

```bash
# 1. Install
npm install
cd frontend && npm install && cd ..

# 2. Build the frontend
npm run build

# 3. Set a password (omit to disable auth — only sane for local-only dev)
export WIZ_PASSWORD='your-strong-password'

# 4. Run
npm start
# server logs the URLs it's serving:
#   🌐 Frontend:  http://localhost:3000
#   📡 API:       http://localhost:3000/api
#   🔌 WebSocket: ws://localhost:3000
```

Open http://localhost:3000, sign in, and use **Devices → Scan Network** to find bulbs.
Add them, organize into groups, build scenes and automations.

For long-running deployment under PM2 see [README-DEPLOYMENT.md](./README-DEPLOYMENT.md).

## Configuration

Everything lives under `config/`. All files are auto-created on first run and
**gitignored** (treat as local runtime data):

| File | Holds |
|---|---|
| `lights.json` | Configured bulbs (id, mac, ip, name) |
| `groups.json` | Group definitions and nesting |
| `automations.json` | Scenes + scheduled routines |
| `location.json` | Lat/lon for sunrise/sunset (default: Hyderabad) |
| `state-proxy.json` | Live desired state per bulb (debounced runtime data) |
| `auth.json` | Token signing secret (auto-generated; do not share) |

### Environment variables

| Var | Purpose |
|---|---|
| `WIZ_PASSWORD` | Required to enable login. Unset = auth disabled (with startup warning). |
| `PORT` | HTTP port. Default `3000`. |
| `LOG_LEVEL` | `ERROR` / `WARN` / `INFO` / `VERBOSE` / `TRACE`. Default `INFO`. |
| `NODE_ENV` | `production` enables Vite-built static assets via the same server. |

## Discovery & control utilities (CLI)

```bash
npm run discover         # broadcast discovery
npm run discover:save    # also write lights.json
npm run discover:subnet  # subnet scan fallback (slower)

npm test                 # CLI smoke test against configured bulbs
npm run test:push        # one-shot push registration
npm run test:push:live   # push + keep-alive registrations
```

## License

MIT
