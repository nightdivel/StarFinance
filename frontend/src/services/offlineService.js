// Оффлайн сервис для работы без бэкенда
import { API_BASE_URL } from '../config';
class OfflineService {
  constructor() {
    this.isOnline = false;
    this.checkConnection();
  }

  async checkConnection() {
    try {
      const response = await fetch(`${API_BASE_URL}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      this.isOnline = response.ok;
    } catch (error) {
      this.isOnline = false;
      console.log('Оффлайн режим активирован');
    }
  }

  // Локальная авторизация
  async loginLocal(username, password) {
    // 1) Встроённая учётка администратора
    if (username === 'admin' && password === 'admin') {
      return {
        authToken: 'offline-admin-token',
        username: 'admin',
        accountType: 'Администратор',
        offline: true,
        permissions: {
          finance: 'write',
          warehouse: 'write',
          users: 'write',
          directories: 'write',
          settings: 'write',
        },
      };
    }

    // 2) Попробовать найти пользователя в сохранённых данных приложения
    try {
      const cached = typeof window !== 'undefined' ? localStorage.getItem('appData') : null;
      if (cached) {
        const appData = JSON.parse(cached);
        const users = Array.isArray(appData?.users) ? appData.users : [];
        const found = users.find(
          (u) => u?.username === username && (u?.password || '') === password
        );
        if (found) {
          return {
            authToken: `offline-token-${found.id || Date.now()}`,
            username: found.username,
            accountType: found.accountType || 'Пользователь',
            offline: true,
            permissions: found.permissions || {},
          };
        }
      }
    } catch (_) {
      // ignore parse errors
    }

    throw new Error('Неверный логин или пароль');
  }

  // Получение тестовых данных
  getDemoData() {
    return {
      system: {
        version: '1.0.0',
        currencies: ['aUEC', 'КП'],
        baseCurrency: 'aUEC',
        rates: { aUEC: 1, КП: 0.9 },
      },
      warehouse: [
        {
          id: 1,
          name: 'Тестовый товар',
          type: 'Товар',
          quantity: 10,
          price: 100,
          currency: 'aUEC',
        },
      ],
      users: [
        {
          id: 'admin_1',
          username: 'admin',
          email: 'admin@starfinance.com',
          authType: 'local',
          accountType: 'Администратор',
          permissions: {
            finance: 'write',
            warehouse: 'write',
            users: 'write',
            directories: 'write',
            settings: 'write',
          },
          isActive: true,
        },
      ],
      transactions: [],
      directories: {
        productTypes: ['Услуга', 'Товар'],
        showcaseStatuses: ['На витрине', 'Скрыт'],
        productNames: ['Тестовый товар', 'Комплектующие', 'Услуга обслуживания'],
        accountTypes: [
          {
            name: 'Администратор',
            permissions: {
              finance: 'write',
              warehouse: 'write',
              users: 'write',
              directories: 'write',
              settings: 'write',
            },
          },
          {
            name: 'Пользователь',
            permissions: {
              finance: 'read',
              warehouse: 'write',
              users: 'none',
              directories: 'read',
              settings: 'none',
            },
          },
          {
            name: 'Гость',
            permissions: {
              finance: 'read',
              warehouse: 'read',
              users: 'none',
              directories: 'read',
              settings: 'none',
            },
          },
        ],
      },
    };
  }
}

export default OfflineService;
