# AI NPC City Prototype

A browser-first technical prototype demonstrating a 3D explorable neighborhood populated by persistent AI NPCs. The language model runs locally in the browser.

## Tech Stack
- TypeScript
- Vite
- Three.js (WebGPURenderer)
- Transformers.js (for browser ML inference via WebGPU)
- IndexedDB (for persistence)
- Vitest & Playwright (Testing)

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the dev server:
   ```bash
   npm run dev
   ```

3. Open your browser at `http://localhost:5173`. Ensure your browser supports WebGPU (e.g. recent versions of Chrome/Edge).

## Testing

Run unit tests:
```bash
npm run test
```

Run e2e tests:
```bash
npm run test:e2e
```
