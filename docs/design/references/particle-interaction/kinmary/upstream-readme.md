# ✦ Cursor Particle Displacement — Three.js

An interactive WebGL particle effect where your cursor displaces a particle cloud rendered from an image. Built with Three.js, custom GLSL shaders, and Vite.

🔗 **[Live Demo](https://kinmary.github.io/cursor-particle-displacement/)**

![Three.js](https://img.shields.io/badge/Three.js-r158-black?logo=three.js) ![Vite](https://img.shields.io/badge/Vite-4-646CFF?logo=vite) ![GLSL](https://img.shields.io/badge/GLSL-shaders-orange)

---

## ✨ Features

- **Image-based particle system** — particle density and colour are sampled directly from a texture
- **Cursor displacement** — a 2D canvas tracks your pointer and feeds a displacement texture to the GPU each frame
- **Custom GLSL shaders** — vertex shader handles displacement, point sizing, and luminance; fragment shader draws smooth circular particles
- **Orbit controls** — rotate, zoom, and pan the scene freely
- **Debug GUI** — append `#debug` to the URL to unlock live tweaks (see below)

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+

### Install & Run

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build for Production

```bash
npm run build
```

Output goes to `dist/`.

---

## 🎛️ Debug Mode

Append `#debug` to the URL to open the live GUI panel:

```
http://localhost:5173/#debug
```

| Panel | Tweak | Description |
|---|---|---|
| **Particles** | Point Size | Scale of each particle dot |
| **Particles** | Displacement Strength | How far particles explode from the cursor trail |
| **Particles** | Blending | Toggle Normal ↔ Additive blending |
| **Displacement** | Fade Speed | How quickly the glow trail fades |
| **Displacement** | Glow Size | Radius of the cursor brush |
| **Displacement** | Cursor Sensitivity | Movement threshold for full glow intensity |

---

## 🗂️ Project Structure

```
src/
├── index.html
├── script.js                     # Entry point
├── style.css
├── experience/
│   ├── Experience.js             # Singleton orchestrator
│   ├── Camera.js                 # PerspectiveCamera + OrbitControls
│   ├── Renderer.js               # WebGLRenderer setup
│   ├── sources.js                # Asset manifest
│   ├── utils/
│   │   ├── Debug.js              # lil-gui debug panel
│   │   ├── Displacement.js       # 2D canvas cursor tracker + CanvasTexture
│   │   ├── EventEmitter.js       # Pub/sub utility
│   │   ├── Resources.js          # Asset loader
│   │   ├── Sizes.js              # Viewport + pixelRatio
│   │   └── Time.js               # RAF-based ticker
│   └── world/
│       ├── World.js              # Scene root
│       └── Particles.js          # ShaderMaterial + Points mesh
└── shaders/
    └── particles/
        ├── vertex.glsl           # Displacement, point sizing, colour sampling
        └── fragment.glsl         # Circular point rendering
static/
├── ShadowsCollideWithPeople.jpg  # Source image for particles
└── glow.png                      # Cursor glow brush
```

---

## 🛠️ Tech Stack

| Library | Purpose |
|---|---|
| [Three.js](https://threejs.org/) | 3D renderer & scene graph |
| [Vite](https://vitejs.dev/) | Dev server & bundler |
| [vite-plugin-glsl](https://github.com/UstymUkhman/vite-plugin-glsl) | Import `.glsl` files as strings |
| [vite-plugin-restart](https://github.com/antfu/vite-plugin-restart) | Auto-restart on static asset changes |
| [lil-gui](https://lil-gui.georgealways.com/) | Debug controls panel |

---

## 📄 License

MIT
