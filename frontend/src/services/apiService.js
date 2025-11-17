import { API_BASE_URL } from '../config';

class ApiService {
  constructor() {
    this.baseURL = API_BASE_URL;
  }

  buildUrl(path) {
    const base = (this.baseURL || '').replace(/\/$/, '');
    const rel = String(path || '');
    return base + (rel.startsWith('/') ? rel : '/' + rel);
  }

  async request(endpoint, options = {}) {
    try {
      // Use relative path to go through nginx and keep same-origin
      const url = this.buildUrl(endpoint);
      const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
        ...options,
      });

      if (!response.ok) {
        let bodyText = '';
        try { bodyText = await response.text(); } catch {}
        const err = new Error(`HTTP error! status: ${response.status}`);
        err.status = response.status;
        err.body = bodyText;
        throw err;
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  }

  // -------- New helper methods for normalized backend --------
  // Directories
  getDirectories() {
    return this.request('/api/directories', { method: 'GET' });
  }
  addProductType(name) {
    return this.request('/api/directories/product-types', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }
  deleteProductType(name) {
    return this.request(`/api/directories/product-types/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }
  addShowcaseStatus(name) {
    return this.request('/api/directories/showcase-statuses', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }
  deleteShowcaseStatus(name) {
    return this.request(`/api/directories/showcase-statuses/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }
  addWarehouseLocation(name) {
    return this.request('/api/directories/warehouse-locations', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }
  deleteWarehouseLocation(name) {
    return this.request(`/api/directories/warehouse-locations/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }
  addWarehouseType(name) {
    return this.request('/api/directories/warehouse-types', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }
  deleteWarehouseType(name) {
    return this.request(`/api/directories/warehouse-types/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }

  // Currencies
  getCurrenciesConfig() {
    return this.request('/api/system/currencies', { method: 'GET' });
  }
  updateCurrenciesConfig({ currencies, baseCurrency, rates }) {
    return this.request('/api/system/currencies', {
      method: 'PUT',
      body: JSON.stringify({ currencies, baseCurrency, rates }),
    });
  }

  // Warehouse
  getWarehouse() {
    return this.request('/api/warehouse', { method: 'GET' });
  }
  saveWarehouseItem(item) {
    if (item?.id) {
      return this.request(`/api/warehouse/${encodeURIComponent(item.id)}`, {
        method: 'PUT',
        body: JSON.stringify(item),
      });
    }
    return this.request('/api/warehouse', { method: 'POST', body: JSON.stringify(item) });
  }
  deleteWarehouseItem(id) {
    return this.request(`/api/warehouse/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  changeWarehouseQuantity(id, quantity) {
    return this.request(`/api/warehouse/${encodeURIComponent(id)}/quantity`, {
      method: 'PATCH',
      body: JSON.stringify({ quantity }),
    });
  }

  // Showcase
  getShowcase() {
    return this.request('/api/showcase', { method: 'GET' });
  }
  saveShowcaseItem(item) {
    if (item?.id) {
      return this.request(`/api/showcase/${encodeURIComponent(item.id)}`, {
        method: 'PUT',
        body: JSON.stringify(item),
      });
    }
    return this.request('/api/showcase', { method: 'POST', body: JSON.stringify(item) });
  }
  deleteShowcaseItem(id) {
    return this.request(`/api/showcase/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  deleteShowcaseByWarehouse(warehouseItemId) {
    return this.request(`/api/showcase/by-warehouse/${encodeURIComponent(warehouseItemId)}`, {
      method: 'DELETE',
    });
  }

  // Transactions
  getTransactions() {
    return this.request('/api/transactions', { method: 'GET' });
  }
  saveTransaction(tr) {
    if (tr?.id) {
      return this.request(`/api/transactions/${encodeURIComponent(tr.id)}`, {
        method: 'PUT',
        body: JSON.stringify(tr),
      });
    }
    return this.request('/api/transactions', { method: 'POST', body: JSON.stringify(tr) });
  }
  deleteTransaction(id) {
    return this.request(`/api/transactions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // Finance Requests (transaction approvals)
  getRelatedFinanceRequests() {
    return this.request('/api/finance-requests/related', { method: 'GET' });
  }
  confirmFinanceRequest(id) {
    return this.request(`/api/finance-requests/${encodeURIComponent(id)}/confirm`, { method: 'PUT' });
  }
  cancelFinanceRequest(id) {
    return this.request(`/api/finance-requests/${encodeURIComponent(id)}/cancel`, { method: 'PUT' });
  }

  // Purchase Requests
  createRequest({ warehouseItemId, quantity }) {
    return this.request('/api/requests', {
      method: 'POST',
      body: JSON.stringify({ warehouseItemId, quantity }),
    });
  }
  getMyRequests() {
    return this.request('/api/my/requests', { method: 'GET' });
  }
  getCart() {
    return this.getMyRequests();
  }
  getAllRequests() {
    return this.request('/api/requests', { method: 'GET' });
  }
  getRelatedRequests() {
    return this.request('/api/requests/related', { method: 'GET' });
  }
  confirmRequest(id) {
    return this.request(`/api/requests/${encodeURIComponent(id)}/confirm`, { method: 'PUT' });
  }
  cancelRequest(id) {
    return this.request(`/api/requests/${encodeURIComponent(id)}/cancel`, { method: 'PUT' });
  }
  deleteRequest(id) {
    return this.request(`/api/requests/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // Users
  getUsers() {
    return this.request('/api/users', { method: 'GET' });
  }
  saveUser(user) {
    if (user?.id) {
      return this.request(`/api/users/${encodeURIComponent(user.id)}`, {
        method: 'PUT',
        body: JSON.stringify({
          username: user.username,
          nickname: user.nickname,
          email: user.email,
          accountType: user.accountType,
          isActive: user.isActive,
        }),
      });
    }
    return this.request('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        username: user.username,
        nickname: user.nickname,
        email: user.email,
        password: user.password,
        accountType: user.accountType,
        isActive: user.isActive,
      }),
    });
  }
  deleteUser(id) {
    return this.request(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // Passwords
  changeMyPassword({ currentPassword, newPassword }) {
    return this.request('/api/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }
  changeUserPassword(id, { newPassword }) {
    return this.request(`/api/users/${encodeURIComponent(id)}/password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    });
  }

  // Account Types
  addAccountType({ name, permissions, allowedWarehouseTypes }) {
    return this.request('/api/account-types', {
      method: 'POST',
      body: JSON.stringify({ name, permissions, allowedWarehouseTypes }),
    });
  }
  updateAccountType(currentName, { name, permissions, allowedWarehouseTypes }) {
    return this.request(`/api/account-types/${encodeURIComponent(currentName)}`, {
      method: 'PUT',
      body: JSON.stringify({ name, permissions, allowedWarehouseTypes }),
    });
  }
  deleteAccountType(name) {
    return this.request(`/api/account-types/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }

  // Product Names
  addProductName({ name, type, section, uexType, uexCategoryId }) {
    return this.request('/api/directories/product-names', {
      method: 'POST',
      body: JSON.stringify({ name, type, section, uexType, uexCategoryId }),
    });
  }
  updateProductName(currentName, { name, type, section, uexType, uexCategoryId }) {
    return this.request(`/api/directories/product-names/${encodeURIComponent(currentName)}`, {
      method: 'PUT',
      body: JSON.stringify({ name, type, section, uexType, uexCategoryId }),
    });
  }
  deleteProductName(name) {
    return this.request(`/api/directories/product-names/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }

  // User layouts (server persistence)
  getUserLayouts(page) {
    return this.request(`/api/user/layouts/${encodeURIComponent(page)}`, { method: 'GET' });
  }
  saveUserLayouts(page, layouts) {
    return this.request(`/api/user/layouts/${encodeURIComponent(page)}`, {
      method: 'PUT',
      body: JSON.stringify({ layouts }),
    });
  }

  // Discord Scopes dictionary
  getDiscordScopes() {
    return this.request('/api/discord/scopes', { method: 'GET' });
  }
  addDiscordScope(name) {
    return this.request('/api/discord/scopes', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }
  deleteDiscordScope(name) {
    return this.request(`/api/discord/scopes/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }

  // ----- Auth background management -----
  // Public metadata (no auth needed)
  getAuthBackgroundMeta() {
    return this.request('/public/auth/background', { method: 'GET' });
  }
  // Admin: set background from data URL (PNG/JPEG/WebP, <= 500KB)
  setAuthBackground(dataUrl) {
    return this.request('/api/system/auth/background', {
      method: 'PUT',
      body: JSON.stringify({ dataUrl }),
    });
  }
  // Admin: delete background
  deleteAuthBackground() {
    return this.request('/api/system/auth/background', { method: 'DELETE' });
  }

}

export default ApiService;

// Именованный экспорт экземпляра для удобного импорта в компонентах
export const apiService = new ApiService();
