import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  cacheDir: ".vite",
  preview: {
    // Railway uses *.up.railway.app / *.railway.app hostnames.
    // Vite preview blocks unknown hosts by default; allow Railway domains.
    allowedHosts: [".railway.app", "ruts-edu.online", "www.ruts-edu.online"],
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
