import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // changeOrigin stays off so the API sees the browser's host, which its same-origin check compares against Origin.
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 30000 },
});
