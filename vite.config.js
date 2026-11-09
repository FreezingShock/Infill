import { defineConfig } from 'vite';
import areasPlugin from './tools/vite-areas.js';

// `npm run dev` serves the game on http://localhost:5173; area packs live in public/areas.
export default defineConfig({
  base: './',
  plugins: [areasPlugin()],
  server: { port: 5173, open: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
