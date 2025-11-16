import ApiService from './apiService';

class AuthService {
  constructor() {
    this.apiService = new ApiService();
  }

  async loginLocal(username, password) {
    try {
      const response = await this.apiService.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });

      if (response.authToken) {
        localStorage.setItem('authToken', response.authToken);
        localStorage.setItem(
          'userData',
          JSON.stringify({
            username: response.username,
            accountType: response.accountType,
            offline: response.offline || false,
            permissions: response.permissions || {},
          })
        );
      }

      return response;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  logout() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userData');
  }

  getCurrentUser() {
    const userData = localStorage.getItem('userData');
    return userData ? JSON.parse(userData) : null;
  }

  isAuthenticated() {
    return !!localStorage.getItem('authToken');
  }

  // Простейшая проверка прав. При необходимости заменить на реальную логику.
  hasPermission(section, action) {
    try {
      const user = this.getCurrentUser();
      if (!user) return false;

      const perms = user.permissions || {};
      const p = perms[section];
      if (!p) {
        // Нет явного права на ресурс — нет доступа (для всех типов, включая администратора)
        return false;
      }

      if (action === 'write') {
        return p === 'write';
      }
      // action === 'read'
      return p === 'read' || p === 'write';
    } catch (_) {
      return false;
    }
  }
}

export default AuthService;

// Именованный экспорт экземпляра для удобного импорта в компонентах
export const authService = new AuthService();
