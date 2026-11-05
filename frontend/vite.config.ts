import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// SmartFolio frontend — static SPA build, deployable to Vercel.
// The production backend (FastAPI) is a separate service consumed over HTTP.
export default defineConfig({
  plugins: [react()],
  build: {
    // Keep a machine-readable graph so CI can enforce the lazy-loading
    // contract instead of relying on a developer noticing Vite's warning.
    manifest: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'ionic',
              test: /node_modules[\\/](@ionic|ionicons)[\\/]/,
              priority: 30,
              maxSize: 350_000,
            },
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|react-router|scheduler|zustand)[\\/]/,
              priority: 20,
              maxSize: 350_000,
            },
            {
              name: 'vendor',
              test: /node_modules[\\/]/,
              priority: 10,
              maxSize: 350_000,
            },
          ],
          maxSize: 400_000,
        },
      },
    },
  },
})
