import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import pkg from './package.json';

// Relative base so the build works both when hosted under a sub-path
// (GitHub Pages) and when loaded from the local filesystem inside Electron.
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // Dev-Proxy zum Familien-Server (server/): hält Frontend + API same-origin,
  // damit die httpOnly-Session-Cookies ohne CORS funktionieren.
  // Nutzung: VITE_API_URL=/api npm run dev  (Server: cd server && bun run dev)
  server: {
    proxy: {
      '/api': {
        target: process.env.SCHREIBZEIT_API ?? 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Schreibzeit',
        short_name: 'Schreibzeit',
        description:
          'Lernwörter-Kartei, Knickblätter und KI-Übungstexte für Grundschullehrkräfte – local-first und offline.',
        lang: 'de',
        theme_color: '#2f6f5e',
        background_color: '#f6f3ec',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // json einschließen, damit das Wörterbuch (nouns.json) offline verfügbar ist.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,json}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // The app must keep working offline; never try to reach the network
        // for navigation requests once cached.
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
