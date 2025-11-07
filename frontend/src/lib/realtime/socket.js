import { io } from 'socket.io-client';
import { API_BASE_URL } from '../../config';

// Singleton socket client. Adjust URL if needed (same-origin by default)
let socket;

export function getSocket() {
  if (!socket) {
    const base = String(API_BASE_URL || '').replace(/\/$/, '');
    const socketPath = `${base}/socket.io` || '/socket.io';
    socket = io('/', {
      transports: ['websocket'],
      autoConnect: true,
      withCredentials: true,
      path: socketPath,
    });
  }
  return socket;
}
