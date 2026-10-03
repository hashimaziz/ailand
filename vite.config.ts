import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    // Fail loudly instead of silently moving to 5174, 5175, ... A stale dev
    // server left running is otherwise invisible: the app works, but on a port
    // nobody is looking at, and anything hard-coded to 5173 breaks.
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'esnext'
  }
});
