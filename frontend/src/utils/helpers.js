import { CURRENCY_FORMAT } from '../config/appConfig';

// Currency formatting
export const formatCurrency = (amount, currency) => {
  const config = CURRENCY_FORMAT[currency] || {
    precision: 2,
    thousandSeparator: ' ',
    decimalSeparator: '.',
  };

  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: config.precision,
    maximumFractionDigits: config.precision,
  }).format(amount);
};

// Date formatting
export const formatDate = (date, format = 'DD.MM.YYYY HH:mm:ss') => {
  const d = new Date(date);

  const pad = (num) => num.toString().padStart(2, '0');

  const replacements = {
    YYYY: d.getFullYear(),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  };

  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (match) => replacements[match]);
};

// Locale-aware string compare for dropdowns: 0-9, А-Я, A-Z
export const compareDropdownStrings = (a, b) => {
  const sa = String(a ?? '').trim();
  const sb = String(b ?? '').trim();
  if (!sa && !sb) return 0;
  if (!sa) return 1;
  if (!sb) return -1;

  const isDigit = (ch) => /[0-9]/.test(ch);
  const isCyr = (ch) => /[\u0400-\u04FF]/.test(ch);
  const isLat = (ch) => /[A-Za-z]/.test(ch);

  const cat = (s) => {
    const ch = s[0];
    if (isDigit(ch)) return 0;
    if (isCyr(ch)) return 1;
    if (isLat(ch)) return 2;
    return 3;
  };

  const ca = cat(sa);
  const cb = cat(sb);
  if (ca !== cb) return ca - cb;

  return sa.localeCompare(sb, 'ru-RU', { sensitivity: 'base' });
};

// Debounce function
export const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

// Deep clone object
export const deepClone = (obj) => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj);
  if (obj instanceof Array) return obj.map((item) => deepClone(item));

  const cloned = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  return cloned;
};

// Generate unique ID
export const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

// Validate email
export const validateEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

// Validate password strength
export const validatePassword = (password) => {
  const minLength = 6;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);

  return {
    isValid: password.length >= minLength && hasUpperCase && hasLowerCase && hasNumbers,
    issues: [
      password.length < minLength && `Минимум ${minLength} символов`,
      !hasUpperCase && 'Заглавные буквы',
      !hasLowerCase && 'Строчные буквы',
      !hasNumbers && 'Цифры',
    ].filter(Boolean),
  };
};

// File size formatting
export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Array helpers
export const arrayHelpers = {
  // Remove duplicates from array
  unique: (array) => [...new Set(array)],

  // Group by property
  groupBy: (array, key) => {
    return array.reduce((groups, item) => {
      const group = item[key];
      groups[group] = groups[group] || [];
      groups[group].push(item);
      return groups;
    }, {});
  },

  // Sort by property
  sortBy: (array, key, direction = 'asc') => {
    return array.sort((a, b) => {
      if (a[key] < b[key]) return direction === 'asc' ? -1 : 1;
      if (a[key] > b[key]) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  },

  // Chunk array
  chunk: (array, size) => {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  },
};

// Object helpers
export const objectHelpers = {
  // Check if object is empty
  isEmpty: (obj) => {
    return Object.keys(obj).length === 0;
  },

  // Get nested property
  get: (obj, path, defaultValue = undefined) => {
    const travel = (regexp) =>
      String.prototype.split
        .call(path, regexp)
        .filter(Boolean)
        .reduce((res, key) => (res !== null && res !== undefined ? res[key] : res), obj);

    const result = travel(/[,[\]]+?/) || travel(/[,[\].]+?/);
    return result === undefined || result === obj ? defaultValue : result;
  },

  // Merge objects deeply
  merge: (target, source) => {
    for (const key in source) {
      if (source[key] instanceof Object && key in target) {
        objectHelpers.merge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
    return target;
  },
};

// Local storage helpers
export const storage = {
  get: (key, defaultValue = null) => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch {
      return defaultValue;
    }
  },

  set: (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  remove: (key) => {
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },

  clear: () => {
    try {
      localStorage.clear();
      return true;
    } catch {
      return false;
    }
  },
};

// Export all helpers
export default {
  formatCurrency,
  formatDate,
  debounce,
  deepClone,
  generateId,
  validateEmail,
  validatePassword,
  formatFileSize,
  arrayHelpers,
  objectHelpers,
  storage,
};
