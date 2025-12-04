import ApiService from './apiService';

/**
 * Сервис для работы с аутентификацией
 */
class AuthService {
  constructor() {
    this.apiService = new ApiService();
    this.tokenKey = 'authToken';
    this.userDataKey = 'userData';
  }

  /**
   * Вход с использованием логина и пароля
   */
  async loginLocal(username, password) {
    try {
      console.log('Attempting local login for user:', username);
      
      const response = await this.apiService.request('/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      console.log('Login response:', response);

      if (response && response.authToken) {
        this._saveAuthData({
          token: response.authToken,
          userData: {
            username: response.username,
            accountType: response.accountType,
            offline: response.offline || false,
            permissions: response.permissions || {},
            avatarUrl: response.avatarUrl || null
          }
        });
        
        console.log('Local login successful');
      } else {
        throw new Error('Неверный формат ответа сервера');
      }

      return response;
    } catch (error) {
      console.error('Local login error:', error);
      const errorMessage = error.message || 'Ошибка входа. Проверьте логин и пароль.';
      throw new Error(errorMessage);
    }
  }

  /**
   * Выход из системы
   */
  logout() {
    console.log('Logging out user');
    try {
      localStorage.removeItem(this.tokenKey);
      localStorage.removeItem(this.userDataKey);
      console.log('User logged out successfully');
    } catch (error) {
      console.error('Error during logout:', error);
    }
  }

  /**
   * Получение данных текущего пользователя
   */
  getCurrentUser() {
    try {
      const userData = localStorage.getItem(this.userDataKey);
      return userData ? JSON.parse(userData) : null;
    } catch (error) {
      console.error('Error getting current user:', error);
      return null;
    }
  }

  /**
   * Проверка аутентификации пользователя
   */
  isAuthenticated() {
    try {
      return !!localStorage.getItem(this.tokenKey);
    } catch (error) {
      console.error('Error checking authentication:', error);
      return false;
    }
  }

  /**
   * Проверка прав доступа
   * @param {string} section - Раздел (например, 'users', 'products')
   * @param {string} action - Действие ('read' или 'write')
   * @returns {boolean} - Есть ли у пользователя запрошенное право
   */
  hasPermission(section, action = 'read') {
    try {
      const user = this.getCurrentUser();
      
      // Если пользователь не аутентифицирован, прав нет
      if (!user) {
        console.log('Permission denied: user not authenticated');
        return false;
      }

      // Администратор имеет все права
      if (user.accountType === 'Администратор') {
        console.log('Admin access granted');
        return true;
      }

      // Проверяем права доступа
      const permissions = user.permissions || {};
      const permission = permissions[section];
      
      if (!permission) {
        console.log(`No permission for section: ${section}`);
        return false;
      }

      // Проверяем уровень доступа
      const permissionLevels = { none: 0, read: 1, write: 2 };
      const requiredLevel = permissionLevels[action] || 0;
      const userLevel = permissionLevels[permission] || 0;
      
      const hasAccess = userLevel >= requiredLevel;
      console.log(`Permission check - Section: ${section}, Action: ${action}, Has Access: ${hasAccess}`);
      
      return hasAccess;
    } catch (error) {
      console.error('Error checking permissions:', error);
      return false;
    }
  }

  /**
   * Сохранение данных аутентификации
   * @private
   */
  _saveAuthData({ token, userData }) {
    try {
      if (!token) {
        throw new Error('No token provided');
      }
      
      localStorage.setItem(this.tokenKey, token);
      
      if (userData) {
        localStorage.setItem(
          this.userDataKey,
          JSON.stringify(userData)
        );
      }
      
      console.log('Auth data saved successfully');
    } catch (error) {
      console.error('Error saving auth data:', error);
      throw new Error('Ошибка сохранения данных аутентификации');
    }
  }
}

export default AuthService;

// Именованный экспорт экземпляра для удобного импорта в компонентах
export const authService = new AuthService();
