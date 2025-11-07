import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    base: env.BASE_PATH || '/',
    server: {
      port: 5173,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/auth': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        // Health check (used by ApiService.checkConnection)
        '/health': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        // Socket.IO websocket endpoint
        '/socket.io': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          ws: true,
        },
        // Static flags/endpoints served by backend
        '/public': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/favicon.ico': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  };
});
