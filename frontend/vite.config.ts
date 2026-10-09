import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: `npm run dev` -> API diteruskan ke ASP.NET Core (dotnet run, default http://127.0.0.1:5080).
export default defineConfig({
  // Base path: '/' (domain root) atau mis. '/Dashboard_semen/' bila aplikasi di sub-folder. Set lewat env VITE_BASE saat build.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: { port: 5173, proxy: { '^.*/api': { target: process.env.VITE_API_PROXY ?? 'http://127.0.0.1:5080', changeOrigin: true } } },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1500 },
});
