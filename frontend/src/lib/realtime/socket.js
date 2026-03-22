import { io } from 'socket.io-client';
import { API_BASE_URL } from '../../config';

// Singleton socket client. Adjust URL if needed (same-origin by default)
let socket;

export function getSocket() {
  if (!socket) {
    const base = String(API_BASE_URL || '').replace(/\/$/, '');
    // Определяем правильный URL для Socket.IO с учетом пути /economy/
    let socketUrl;
    if (base) {
      // Если есть API_BASE_URL, используем его
      socketUrl = base;
    } else {
      // Иначе используем текущий origin с путем /economy если мы на production
      const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
      if (isProduction && window.location.pathname.includes('/economy')) {
        socketUrl = window.location.origin + '/economy';
      } else {
        socketUrl = window.location.origin;
      }
    }
    
    socket = io(socketUrl, {
      transports: ['websocket'],
      autoConnect: true,
      withCredentials: true,
    });

    // Добавляем обработку ошибок для отладки
    socket.on('connect_error', (error) => {
      console.error('[Socket.IO] Connection error:', error);
      console.error('[Socket.IO] URL used:', socketUrl);
    });

    socket.on('connect', () => {
      console.log('[Socket.IO] Connected successfully to:', socketUrl);
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket.IO] Disconnected:', reason);
    });
  }
  return socket;
}
