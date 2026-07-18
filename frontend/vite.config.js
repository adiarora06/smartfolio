import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// SmartFolio frontend — static SPA build, deployable to Vercel.
// The production backend (FastAPI) is a separate service consumed over HTTP.
export default defineConfig({
    plugins: [react()],
});
