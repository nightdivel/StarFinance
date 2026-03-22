const rawBase = import.meta.env.VITE_API_BASE_URL || import.meta.env.BASE_URL || '/';
const API_BASE_URL = (!rawBase || rawBase === '/') ? '' : String(rawBase).replace(/\/$/, '');
const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL || '';

// Константы для приложения
const APP_CONFIG = {
  pagination: {
    newsPageSize: 10,
    defaultPageSize: 10,
  },
  upload: {
    maxImageSize: 5 * 1024 * 1024, // 5MB
    allowedImageTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
  },
  validation: {
    newsTitle: {
      maxLength: 255,
    },
    newsSummary: {
      maxLength: 1000,
    },
    newsContent: {
      maxLength: 50000,
    },
  },
};

export {
  API_BASE_URL,
  FRONTEND_URL,
  APP_CONFIG
};
