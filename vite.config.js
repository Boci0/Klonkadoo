import { defineConfig } from 'vite';

// `--mode android` (Capacitor) and `--mode app` (Tauri desktop) produce
// relative-path builds; the default build targets GitHub Pages.
export default defineConfig(({ mode }) => ({
  base: mode === 'android' || mode === 'app' ? './' : '/Klonkadoo/',
  server: {
    port: 5173,
    open: mode !== 'app', // the Tauri window opens instead of a browser tab
    strictPort: true
  },
  build: {
    outDir: 'dist',
  },
}));
