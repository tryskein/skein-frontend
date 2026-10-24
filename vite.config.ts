import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Node global at config-evaluation time. We don't depend on @types/node
// for the rest of the project, so a minimal local declaration is cheaper
// than pulling the package in just for one env-var read.
declare const process: { env: Record<string, string | undefined> };

// In production this bundle is served by skein-web (.NET BFF) from
// wwwroot/, so /api/* hits the same origin as the SPA. In `vite dev`
// we forward /api/* and /hub to skein-web so cookies stay same-origin
// across the proxy.
//
// VITE_PROXY_TARGET overrides the default — used when vite runs in a
// docker container alongside skein-web, where the target is the docker
// service name `http://skein-web:8080`. On the host (default), it's
// `http://localhost:8080`.
const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Vite 5+ rejects unknown Host headers by default (DNS rebinding
    // mitigation). In dev we run inside a docker container reachable as
    // localhost / host.docker.internal / the LAN IP — list them.
    // (`true` would allow ALL hosts but Vite 5.4.21 still rejects with
    // "Blocked request" on some host strings; explicit list is safer.)
    allowedHosts: ['localhost', '127.0.0.1', 'host.docker.internal', '.localhost'],
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: false,
      },
      // SignalR Hub at /hub — needs WebSocket upgrade.
      '/hub': {
        target: proxyTarget,
        changeOrigin: false,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
