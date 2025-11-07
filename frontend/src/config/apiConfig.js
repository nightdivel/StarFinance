import { APP_CONFIG } from './appConfig';

export const API_CONFIG = {
  BASE_URL: APP_CONFIG.API.BASE_URL,

  ENDPOINTS: {
    // Auth endpoints
    LOGIN: `${APP_CONFIG.API.BASE_URL}${APP_CONFIG.API.ENDPOINTS.LOGIN}`,
    CHANGE_PASSWORD: `${APP_CONFIG.API.BASE_URL}${APP_CONFIG.API.ENDPOINTS.CHANGE_PASSWORD}`,
    DISCORD_AUTH: `${APP_CONFIG.API.BASE_URL}${APP_CONFIG.API.ENDPOINTS.DISCORD_AUTH}`,

    // Data endpoints
    DATA: `${APP_CONFIG.API.BASE_URL}${APP_CONFIG.API.ENDPOINTS.DATA}`,
    USERS: `${APP_CONFIG.API.BASE_URL}${APP_CONFIG.API.ENDPOINTS.USERS}`,

    // Resource endpoints
    WAREHOUSE: `${APP_CONFIG.API.BASE_URL}/api/warehouse`,
    TRANSACTIONS: `${APP_CONFIG.API.BASE_URL}/api/transactions`,
    DIRECTORIES: `${APP_CONFIG.API.BASE_URL}/api/directories`,
  },

  HEADERS: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },

  DEFAULT_OPTIONS: {
    credentials: 'include',
    mode: 'cors',
  },

  ERROR_MESSAGES: {
    NETWORK_ERROR: 'Ошибка сети. Проверьте подключение к интернету.',
    SERVER_ERROR: 'Ошибка сервера. Попробуйте позже.',
    UNAUTHORIZED: 'Требуется авторизация.',
    FORBIDDEN: 'Доступ запрещен.',
    NOT_FOUND: 'Ресурс не найден.',
    TIMEOUT: 'Время запроса истекло.',
  },
};

// API response status handlers
export const API_STATUS = {
  SUCCESS: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SERVER_ERROR: 500,
};

// HTTP methods
export const HTTP_METHODS = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  DELETE: 'DELETE',
  PATCH: 'PATCH',
};
