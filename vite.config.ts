import { defineConfig } from 'vite';

export default defineConfig({
  base: '/seer/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: '127.0.0.1',
    port: 5175,
  },
});
