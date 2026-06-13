# WiZ Home Controller - React Frontend

Modern React + TypeScript frontend for WiZ Home Controller.

## Tech Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **TailwindCSS** - Styling
- **React Router** - Navigation
- **Socket.io Client** - Real-time updates
- **Lucide React** - Icons

## Getting Started

### Install Dependencies

```bash
npm install
```

### Development

```bash
npm run dev
```

Runs on `http://localhost:5173` with proxy to backend at `http://localhost:3000`

### Build

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## Project Structure

```
src/
├── components/       # Reusable UI components
│   ├── Header.tsx
│   ├── LightCard.tsx
│   └── SignalStrength.tsx
├── pages/           # Page components
│   ├── Dashboard.tsx
│   └── Devices.tsx
├── services/        # API and WebSocket services
│   ├── api.ts
│   └── socket.tsx
├── types/           # TypeScript type definitions
│   └── index.ts
├── App.tsx          # Main app component
├── main.tsx         # Entry point
└── index.css        # Global styles
```

## Features

- 🎨 Modern, responsive UI
- 🔄 Real-time light status updates
- 💡 Individual light control (on/off, brightness, temperature)
- 📊 Signal strength indicators
- 🔍 Device discovery and management
- ⚡ Fast initial load with deferred status updates
- 🌐 WebSocket integration for live updates
