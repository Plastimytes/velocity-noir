// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'es2020',
    minify: 'terser',
    rollupOptions: {
      output: {
        manualChunks: {
          engine:  ['./src/engine/rendering/Renderer.js', './src/engine/rendering/CarModelEngine.js', './src/engine/rendering/ShaderLibrary.js'],
          physics: ['./src/engine/physics/Physics.js'],
          game:    ['./src/game/CarDatabase.js', './src/game/HeatSystem.js', './src/game/RaceManager.js'],
        },
      },
    },
    terserOptions: {
      compress: { drop_console: true },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    headers: {
      // Required for SharedArrayBuffer (future use)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    include: ['gl-matrix'],
  },
});
