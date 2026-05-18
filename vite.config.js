import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Vite config for the renderer (React) side.
// base: './' is critical for Electron — uses relative paths in built HTML.
export default defineConfig({
  plugins: [react()],
  base: './',
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
    target: 'chrome120'
  },
  server: {
    port: 5173,
    strictPort: true
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
});
