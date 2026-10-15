import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const isDev = process.env.NODE_ENV !== 'production'

export default defineConfig({
  // Bind to all interfaces so the sandbox live-preview proxy can reach the dev server.
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // The platform proxies previews from https://<port>-<id>.e2b.app, which is not
    // localhost, so Vite's host allowlist must stay open for the preview to work.
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    // Tracking + 3D are lazy-loaded chunks; warn only on genuinely large eager chunks.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vite's own preload helper is a virtual module with no node_modules path. It
          // has to live in a chunk the entry already loads, or the bundler hoists it into
          // the first chunk that happens to be shared — which is how the 46 KB MediaPipe
          // bundle ended up statically imported by the entry and parsed on every cold
          // start, even for users who never open Live mode.
          if (id.includes('preload-helper') || id.includes('vite/modulepreload-polyfill')) return 'vendor'
          if (!id.includes('node_modules')) return
          if (id.includes('@mediapipe')) return 'vendor-mediapipe'
          if (id.includes('three/examples')) return 'vendor-three-addons'
          if (id.includes('node_modules/three/')) return 'vendor-three'
          if (id.includes('@react-three')) return 'vendor-r3f'
          if (id.includes('react-dom') || id.includes('/react/')) return 'vendor-react'
          return 'vendor'
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      strategies: 'generateSW',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'models/facecap.glb', 'hdr/studio.hdr'],
      manifest: {
        name: 'Faceverify — 3D Digital Twin',
        short_name: 'Faceverify',
        description:
          'Turn a selfie into a realistic rigged 3D head, then animate it by hand or drive it live with your camera.',
        theme_color: '#0b0d12',
        background_color: '#0b0d12',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['graphics', 'photo', 'entertainment'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2,glb,hdr,json,webmanifest}'],
        // face_landmarker.task (3.7 MB) and the MediaPipe WASM (13.5 MB raw) are excluded
        // from precache on purpose: they are only needed in Live mode and precaching them
        // would blow up first-load data on mid-range Android. They are runtime-cached below,
        // so the second visit is instant and the app still works offline once used.
        // Excluded from precache on purpose:
        //   mediapipe/*  the 13.5 MB WASM runtime + 3.6 MB landmark model, needed only
        //                in Live mode
        //   draco/*      the decoder (plus its 719 KB asm.js fallback) and the basis
        //                transcoder, needed only if a model arrives compressed
        // All of them are runtime-cached below instead, so they are fetched at most once
        // and the app still works offline afterwards. Precaching them would add ~15 MB
        // to the first visit of a user on metered data.
        globIgnores: ['**/mediapipe/**', '**/*.task', '**/*.wasm', '**/draco/**', '**/basis/**'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // MediaPipe WASM runtime (self-hosted).
            urlPattern: ({ url }) => url.pathname.includes('/mediapipe/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'mp-runtime-v1',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
              // Range requests must fall through to the network layer.
              matchOptions: { ignoreSearch: false },
            },
          },
          {
            // Mesh/texture decoders. Only fetched when a GLB actually needs them, and
            // then kept for good: they never change between releases of this app.
            urlPattern: ({ url }) => url.pathname.startsWith('/draco/') || url.pathname.startsWith('/basis/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'codecs-v1',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Avatar GLBs produced by providers are stored in IndexedDB, not here;
            // this covers the bundled sample rig.
            urlPattern: ({ url }) => url.pathname.startsWith('/models/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'models-v1',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  define: {
    __DEV_MODE__: JSON.stringify(isDev),
  },
})
