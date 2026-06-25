import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // When deployed at DigitalOcean, the app is served at /ebay-scanner
  base: process.env.NODE_ENV === 'production' ? '/ebay-scanner/' : '/',
  plugins: [react()],
  server: {
    port: 5175,
    host: true,
  },
})
