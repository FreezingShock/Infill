import { defineConfig } from 'vite';

// `npm run dev` serves the game on http://localhost:5173; area packs live in public/areas.
export default defineConfig({
  base: './',
  server: { port: 5173, open: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
