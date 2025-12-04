// Application configuration
export const APP_CONFIG = {
  APP: {
    TITLE: import.meta.env.VITE_APP_TITLE || 'Star Finance',
    VERSION: '1.0.0',
    DESCRIPTION: 'Система управления финансами и складом',
  },

  API: {
    // Same-origin by default behind nginx. If VITE_API_BASE_URL is set to '/', treat as same-origin ('').
    BASE_URL: (() => {
      const v = import.meta.env.VITE_API_BASE_URL;
      if (!v || v === '/') return '';
      // strip trailing slash to avoid '//endpoint'
      return String(v).replace(/\/$/, '');
    })(),
    ENDPOINTS: {
      DATA: '/api/data',
      LOGIN: '/auth/login',
      CHANGE_PASSWORD: '/api/change-password',
      USERS: '/api/users',
      DISCORD_AUTH: '/auth/discord',
      ECONOMY: '/economy',
    },
    TIMEOUT: 10000,
    RETRY_ATTEMPTS: 3,
  },

  AUTH: {
    ENABLE_DISCORD: import.meta.env.VITE_ENABLE_DISCORD_AUTH === 'true',
    TOKEN_KEY: 'authToken',
    USER_KEY: 'userData',
    TOKEN_REFRESH_INTERVAL: 300000, // 5 minutes
  },

  FEATURES: {
    MULTI_CURRENCY: true,
    WAREHOUSE_MANAGEMENT: true,
    USER_MANAGEMENT: true,
    DIRECTORY_MANAGEMENT: true,
    DISCORD_INTEGRATION: true,
  },

  UI: {
    THEME: {
      PRIMARY_COLOR: '#1890ff',
      SUCCESS_COLOR: '#52c41a',
      WARNING_COLOR: '#faad14',
      ERROR_COLOR: '#f5222d',
    },
    LAYOUT: {
      SIDER_WIDTH: 200,
      SIDER_COLLAPSED_WIDTH: 80,
      HEADER_HEIGHT: 64,
    },
  },

  VALIDATION: {
    USERNAME: {
      MIN_LENGTH: 3,
      MAX_LENGTH: 20,
      PATTERN: /^[a-zA-Z0-9_]+$/,
    },
    PASSWORD: {
      MIN_LENGTH: 4,
      MAX_LENGTH: 30,
    },
    EMAIL: {
      PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
  },
};

// User roles and permissions
export const USER_ROLES = {
  ADMIN: 'Администратор',
  USER: 'Пользователь',
  GUEST: 'Гость',
};

export const PERMISSIONS = {
  NONE: 'none',
  READ: 'read',
  WRITE: 'write',
};

// Currency formatting
export const CURRENCY_FORMAT = {
  aUEC: {
    symbol: 'aUEC',
    precision: 2,
    thousandSeparator: ' ',
    decimalSeparator: '.',
  },
  КП: {
    symbol: 'КП',
    precision: 2,
    thousandSeparator: ' ',
    decimalSeparator: '.',
  },
};

// Warehouse types
export const WAREHOUSE_TYPES = {
  PRODUCT: 'Товар',
  SERVICE: 'Услуга',
};

// Showcase statuses
export const SHOWCASE_STATUSES = {
  VISIBLE: 'На витрине',
  HIDDEN: 'Скрыт',
};
