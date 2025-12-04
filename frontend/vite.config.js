import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

const certPath = path.resolve(__dirname, '../certs');
const keyPath = path.join(certPath, 'key.pem');
const certPathFile = path.join(certPath, 'cert.pem');

// Проверяем существование сертификатов
const httpsConfig = fs.existsSync(keyPath) && fs.existsSync(certPathFile)
  ? {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPathFile),
    }
  : false;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    base: env.BASE_PATH || '/',
    server: {
      port: 5173,
      host: '0.0.0.0',
      https: httpsConfig,
      // HMR по WSS при включённом HTTPS
      hmr: httpsConfig
        ? {
            protocol: 'wss',
            host: 'localhost',
            port: 5173,
          }
        : undefined,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          secure: false, // Отключаем проверку SSL для прокси
        },
        '/auth': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          secure: false, // Отключаем проверку SSL для прокси
        },
        // Health check (used by ApiService.checkConnection)
        '/health': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          secure: false, // Отключаем проверку SSL для прокси
        },
        // Socket.IO websocket endpoint
        '/socket.io': {
          target: 'http://localhost:3000',
          ws: true, // Включаем поддержку WebSocket
          changeOrigin: true,
          secure: false, // Отключаем проверку SSL для прокси
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
