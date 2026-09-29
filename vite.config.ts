/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the site from /<repo>/. A relative base breaks the
// HashRouter deep links, so set the repository path explicitly.
export default defineConfig({
  plugins: [react()],
  base: '/galo-multiplayer/',
  define: {
    // mqtt.js pulls in readable-stream, which expects a `global` object.
    global: 'globalThis',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
