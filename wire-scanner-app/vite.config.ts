import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/wire-scanner/' : '/',
  plugins: [react()],
  server: {
    port: 5175,
    host: true,
  },
})
