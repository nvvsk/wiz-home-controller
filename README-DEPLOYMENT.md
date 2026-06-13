# WiZ Home Controller - Deployment Guide

## Development

### Option 1: Frontend + Backend Together (Recommended)
```bash
# Terminal 1: Build frontend once
cd frontend
npm run build

# Terminal 2: Start backend (serves frontend too)
cd ..
npm run dev
# → Open http://localhost:3000
```

### Option 2: Frontend Dev Server (Hot Reload)
```bash
# Terminal 1: Backend
npm run dev

# Terminal 2: Frontend dev server
cd frontend
npm run dev
# → Open http://localhost:5173 (with hot reload)
```

---

## Production

### Build and Start
```bash
# 1. Build frontend
npm run build

# 2. Start server
npm start
# → Serves frontend + API on http://localhost:3000
```

### Or use combined command
```bash
npm run prod
# → Builds frontend and starts server
```

---

## Production with PM2 (Recommended)

```bash
# 1. Install PM2 globally (one-time)
npm install -g pm2

# 2. Build frontend
npm run build

# 3. Start using the project's ecosystem config
npm run pm2:start
# (equivalent to: pm2 start ecosystem.config.js)

# 4. Save PM2 process list so it restores after reboot
pm2 save

# 5. Install PM2 startup hook so PM2 itself launches on boot
pm2 startup
# → follow the printed instructions (usually one sudo command)

# 6. Install log rotation so logs/ doesn't fill the disk
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true

# Day-to-day:
npm run pm2:status   # check running state
npm run pm2:logs     # tail logs
npm run pm2:restart  # restart after deploy
npm run pm2:stop     # stop
```

Logs are written to `./logs/` (gitignored). The ecosystem config
sets `max_memory_restart: 300M`, so if the process leaks memory PM2
restarts it automatically.

---

## Architecture

### Development (Option 1)
```
http://localhost:3000/          → Frontend (built)
http://localhost:3000/api       → Backend API
http://localhost:3000/socket.io → WebSocket
```

### Development (Option 2)
```
http://localhost:5173/          → Frontend (Vite dev server with hot reload)
http://localhost:3000/api       → Backend API (proxied)
http://localhost:3000/socket.io → WebSocket (proxied)
```

### Production
```
http://localhost:3000/          → Frontend (built)
http://localhost:3000/api       → Backend API
http://localhost:3000/socket.io → WebSocket
```

---

## Environment Variables

```bash
# Optional
NODE_ENV=production  # Enables production optimizations
PORT=3000            # Server port (default: 3000)

# Authentication
WIZ_PASSWORD=...     # If set, the UI shows a login screen and all /api/* + WebSocket
                     # connections require a valid bearer token. If NOT set, auth is
                     # disabled and the server logs a warning at startup.
                     # The token-signing secret is auto-generated and persisted to
                     # config/auth.json so logins survive restarts.
                     # Single-user, 7-day token expiry, no explicit logout.
```

Set the password before starting:
```bash
WIZ_PASSWORD='your-strong-password' npm run pm2:start
```

Or add it to `ecosystem.config.js` under the `env` block so PM2 picks it up automatically.

---

## Troubleshooting

### Frontend not found
```bash
# Build the frontend first
cd frontend
npm run build
```

### Port already in use
```bash
# Change port
PORT=3001 npm run dev
```

### WebSocket connection issues
- Make sure firewall allows port 3000
- Check that Socket.IO is connecting to correct URL
