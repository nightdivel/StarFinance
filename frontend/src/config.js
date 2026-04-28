const rawBase = import.meta.env.VITE_API_BASE_URL || '';

const detectApiBase = () => {
  if (rawBase && rawBase !== '/') return String(rawBase).replace(/\/$/, '');

  // Local direct backend run (without Caddy subpath proxy): use root API paths.
  if (typeof window !== 'undefined') {
    const host = String(window.location.hostname || '').toLowerCase();
    const port = String(window.location.port || '');
    if ((host === '127.0.0.1' || host === 'localhost') && port === '3000') {
      return '';
    }
    if (String(window.location.pathname || '').startsWith('/economy')) {
      return '/economy';
    }
  }

  return '';
};

const API_BASE_URL = detectApiBase();
const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL || '';

export {
  API_BASE_URL,
  FRONTEND_URL
};
