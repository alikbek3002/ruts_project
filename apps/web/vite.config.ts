import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  cacheDir: ".vite",
  preview: {
    // Railway uses *.up.railway.app / *.railway.app hostnames.
    // Vite preview blocks unknown hosts by default; allow Railway domains.
    allowedHosts: [".railway.app"],
    port: 8080,
    // In production, proxy only if VITE_API_URL is not set
    ...(process.env.VITE_API_URL ? {} : {
      proxy: {
        '/api': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    }),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
