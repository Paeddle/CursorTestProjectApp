import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/wire/' : '/',
  plugins: [react()],
  server: {
    port: 5178,
    host: true,
  },
})
