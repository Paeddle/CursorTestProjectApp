import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ command, mode }) => {
  const capacitor = mode === 'capacitor'
  const base = capacitor ? './' : command === 'build' ? '/timeclock/' : '/'

  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'Time Clock',
          short_name: 'Time Clock',
          description: 'Personal time clock that works offline and syncs later.',
          theme_color: '#12151c',
          background_color: '#12151c',
          display: 'standalone',
          start_url: base,
          scope: base,
          icons: [
            {
              src: 'icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          navigateFallback: 'index.html',
          globPatterns: ['**/*.{js,css,html,svg,ico,webmanifest}'],
        },
      }),
    ],
    server: {
      port: 5182,
      host: true,
    },
  }
})
