import { io } from 'socket.io-client';

// Singleton socket client. Adjust URL if needed (same-origin by default)
let socket;
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;
const baseReconnectDelay = 1000; // 1 секунда

function getReconnectDelay() {
  // Экспоненциальный backoff с jitter
  const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts), 30000);
  const jitter = Math.random() * 0.3 * delay; // ±30% jitter
  return delay + jitter;
}

export function getSocket() {
  if (!socket) {
    // Определяем URL на основе окружения
    const isProduction = import.meta.env.PROD;
    let socketUrl;
    
    if (isProduction) {
      // В production подключаемся к origin, а путь Socket.IO проксируется через /economy/socket.io*
      // (см. Caddyfile: handle /economy/socket.io* + strip_prefix /economy)
      socketUrl = window.location.origin;
    } else {
      // В разработке используем локальный сервер
      socketUrl = 'http://localhost:3000';
    }
    
    console.log('[Socket.IO] Connecting to:', socketUrl);
    
    // Для Socket.IO нужно использовать полный URL с правильным path
    socket = io(socketUrl, {
      transports: ['websocket'],
      autoConnect: true,
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: maxReconnectAttempts,
      reconnectionDelay: getReconnectDelay(),
      reconnectionDelayMax: 30000,
      timeout: 20000,
      // В production обязателен /economy префикс, иначе запрос уйдёт на /socket.io и не попадёт в proxy правило
      path: isProduction ? '/economy/socket.io/' : '/socket.io/'
    });

    // Добавляем обработку ошибок для отладки
    socket.on('connect_error', (error) => {
      reconnectAttempts++;
      console.error(`[Socket.IO] Connection error (attempt ${reconnectAttempts}/${maxReconnectAttempts}):`, error);
      console.error('[Socket.IO] URL used:', socketUrl);
      
      if (reconnectAttempts >= maxReconnectAttempts) {
        console.error('[Socket.IO] Max reconnection attempts reached. Please refresh the page.');
      }
    });

    socket.on('connect', () => {
      console.log('[Socket.IO] Connected successfully to:', socketUrl);
      reconnectAttempts = 0; // Сбрасываем счетчик при успешном подключении
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket.IO] Disconnected:', reason);
      
      // Если сервер принудительно разорвал соединение, не пытаемся переподключиться
      if (reason === 'io server disconnect') {
        socket.connect();
      }
    });

    socket.on('reconnect', (attemptNumber) => {
      console.log(`[Socket.IO] Reconnected after ${attemptNumber} attempts`);
      reconnectAttempts = 0;
    });

    socket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`[Socket.IO] Reconnection attempt ${attemptNumber}/${maxReconnectAttempts}`);
    });

    socket.on('reconnect_failed', () => {
      console.error('[Socket.IO] Failed to reconnect after all attempts');
    });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    reconnectAttempts = 0;
  }
}
