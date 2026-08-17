import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  // ngrok preview tunnel — Vite blocks unrecognized Host headers by default.
  server: {
    allowedHosts: ['.ngrok-free.app'],
  },
  build: {
    rollupOptions: {
      // Two pages: the app, and the styleguide that proves its design system.
      input: {
        app: path.resolve(__dirname, 'index.html'),
        styleguide: path.resolve(__dirname, 'styleguide.html'),
      },
    },
  },
})
