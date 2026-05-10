# 🏁 Velocity Noir

> A spiritual successor to the 2005 street-racing era. Gritty. High-contrast. Unforgiving.



[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: Android](https://img.shields.io/badge/Platform-Android-green.svg)]()
[![Engine: Custom WebGL](https://img.shields.io/badge/Engine-Custom%20WebGL-orange.svg)]()

---

## 🎮 About

**Velocity Noir** is a mobile street-racing game built with a custom WebGL/Canvas engine, packaged for Android via Capacitor. Inspired by the Black Edition aesthetic of 2005 — high-contrast, neon-wet asphalt, illegal street races, and a brutal cop pursuit system.

### Key Features

- 🚗 **80–95 car roster** — JDM classics, Group B monsters, DTM touring legends
- 🚔 **Heat System** — 5 levels of escalating police pursuit
- 💀 **Pink Slip System** — Lose a boss race, lose your car. Permanently.
- 🏆 **10-Stage Arcade Gauntlet** — 25 events per stage, Gold Mastery unlocks
- 🎨 **Noir Visual Engine** — Custom bloom, wet-asphalt reflections, motion blur
- 📱 **Mobile Controls** — Tilt steering OR 4-button layout
- 🔊 **Binaural Engine Audio** — Anti-lag pops, turbo flutter, straight-cut whine

---

## 🗂️ Project Structure


```
velocity-noir/
├── src/
│   ├── engine/              # Custom game engine core
│   │   ├── Renderer.js      # WebGL renderer + post-processing
│   │   ├── Physics.js       # Arcade-Plus physics model
│   │   ├── InputManager.js  # Tilt / button controls
│   │   ├── AudioEngine.js   # Spatial audio + engine sounds
│   │   ├── AIDriver.js      # Rubber-band AI + cop behavior
│   │   ├── Camera.js        # Chase cam + shake system
│   │   └── AssetLoader.js   # LOD streaming
│   ├── game/                # Game logic layer
│   │   ├── CarDatabase.js   # All 80-95 car stats & specs
│   │   ├── TrackBuilder.js  # Procedural track segments
│   │   ├── HeatSystem.js    # Police pursuit logic
│   │   ├── StakeSystem.js   # Pink slip / impound logic
│   │   ├── ProgressionManager.js  # Stage / event tracking
│   │   ├── RaceManager.js   # Race session controller
│   │   └── GarageManager.js # Car ownership & upgrades
│   ├── ui/                  # All UI screens
│   │   ├── MainMenu.js
│   │   ├── Garage.js
│   │   ├── HUD.js
│   │   ├── MiniMap.js
│   │   ├── PauseMenu.js
│   │   ├── ResultsScreen.js
│   │   └── Tutorial.js
│   └── assets/              # Asset manifests & sprite sheets
│       ├── cars/
│       ├── tracks/
│       ├── ui/
│       └── audio/
├── android/                 # Capacitor Android project
│   └── capacitor.config.json
├── docs/                    # Design documents
│   ├── CAR_ROSTER.md
│   ├── TRACK_LIST.md
│   ├── HEAT_SYSTEM.md
│   └── ARCADE_STAGES.md
├── tools/                   # Build & dev tools
│   └── build.js
├── index.html               # Game entry point
├── package.json
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Android Studio (for APK builds)
- Java 17+

### Development
```bash
npm install
npm run dev          # Starts local dev server at localhost:3000
npm run build        # Production build
npm run android      # Build + open in Android Studio
```

### Building the APK
```bash
npm run build
npx cap sync android
npx cap open android
# In Android Studio: Build > Generate Signed APK
```

---

## 🏎️ Car Classes

| Class | Examples | Strength |
|-------|----------|----------|
| **Group B** | Audi Quattro S1, Lancia Delta S4, Peugeot 205 T16 | Off-road escape, brutal acceleration |
| **JDM** | R34 Skyline, Supra A80, RX-7 FD | Traffic threading, balance |
| **DTM** | BMW 3.0 CSL, Alfa 155 V6 TI, 190E Evo II | Top speed, tarmac dominance |
| **JDM Classic** | Datsun 240Z, AE86, Hakosuka | Style, handling |

---

## 🚔 Heat System

| Level | Units | Tactics |
|-------|-------|---------|
| Heat 1 | Cruisers | Basic chase |
| Heat 2 | Cruisers + Roadblocks | Spike strips |
| Heat 3 | Rhino SUVs | Head-on charges |
| Heat 4 | Rhino + Helicopters | Air surveillance |
| Heat 5+ | Supercar Interceptors + EMP | Full tactical shutdown |

---

## 📋 Development Roadmap

- [x] Project scaffold & architecture
- [ ] Core rendering engine (WebGL + shaders)
- [ ] Physics & input system
- [ ] Car database (all 80-95 cars)
- [ ] Track builder
- [ ] Heat/pursuit AI
- [ ] Story mode framework
- [ ] Arcade stage progression
- [ ] Audio engine
- [ ] UI system
- [ ] Tutorial
- [ ] Android packaging
- [ ] Performance optimization (60fps target)
- [ ] Beta testing

---

## 📄 License

MIT License — See [LICENSE](LICENSE)
