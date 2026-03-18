import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // When deployed at DigitalOcean, the app is served at /scanner; assets must load from /scanner/
  base: process.env.NODE_ENV === 'production' ? '/scanner/' : '/',
  plugins: [react()],
  server: {
    port: 5174,
    host: true,
  },
})
