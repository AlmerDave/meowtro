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
      output: {
        /* Split by how often a thing changes, not by what it is.

           The whole app used to land in one 1MB entry chunk, so editing a
           single line of a component invalidated maplibre in every
           returning visitor's cache along with it. These groups are the
           heavy, near-static dependencies, and separating them is what
           makes a redeploy cheap for somebody who has been here before:
           the app chunk changes, the vendor chunks keep their hashes.

           Named by hand rather than "everything in node_modules": a single
           vendor bundle would be one 1.4MB file that still invalidates
           whole on any dependency bump, which is most of the problem
           again. Each group here is one real reason this app is big.

           three.js is deliberately NOT listed, and that is worth writing
           down because listing it looks harmless and is not. The plate's 3D
           view is parked (plate/Plate.tsx), so nothing imports three,
           @react-three/fiber or drei, and Rollup already tree-shakes them
           out entirely. Naming an absent package here does not produce an
           empty chunk or a no-op: Rollup creates the chunk regardless and
           fills it with whatever shared modules it decides belong there,
           which in this project meant react-dom's scheduler landing in a
           184kB file named "three-*.js". A build artefact that lies about
           what is inside it is worse than no split at all. If the 3D toggle
           comes back, the entry comes back with it. */
        manualChunks: {
          maplibre: ['maplibre-gl', 'pmtiles'],
          motion: ['motion', 'motion/react', 'gsap', 'lenis'],
          react: ['react', 'react-dom', 'react-dom/client'],
        },
      },
    },
    /* maplibre-gl alone is ~960kB minified, and it is the app. The default
       500kB warning fires on it every single build, which trains everyone
       to ignore the warning entirely -- including on the day a chunk that
       should be small is not. Raised just above maplibre so it stays a
       signal: anything tripping this now is genuinely unexpected. */
    chunkSizeWarningLimit: 1000,
  },
})
