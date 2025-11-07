const rawBase = import.meta.env.VITE_API_BASE_URL || import.meta.env.BASE_URL || '/';
const API_BASE_URL = (!rawBase || rawBase === '/') ? '' : String(rawBase).replace(/\/$/, '');
const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL || '';

export {
  API_BASE_URL,
  FRONTEND_URL
};
