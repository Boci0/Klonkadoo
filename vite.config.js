import { defineConfig } from 'vite';

// `vite build --mode android` produces a relative-path build for the
// Capacitor Android app; the default build targets GitHub Pages.
export default defineConfig(({ mode }) => ({
  base: mode === 'android' ? './' : '/Slingshot-OPS/',
  server: {
    port: 5173,
    open: true,
    strictPort: true
  },
  build: {
    outDir: 'dist',
  },
}));
