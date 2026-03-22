import { API_BASE_URL } from '../config';

class NewsService {
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

      if (response.status === 401 || response.status === 403) {
        try { localStorage.removeItem('authToken'); } catch (_) {}
        try { localStorage.removeItem('userData'); } catch (_) {}
        try { window.dispatchEvent(new Event('auth:logout')); } catch (_) {}
        throw new Error('Авторизация истекла');
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }
      return response;
    } catch (error) {
      console.error('NewsService error:', error);
      throw error;
    }
  }

  // Получить все новости с пагинацией
  async getNews(page = 1, limit = 10) {
    return this.request(`/api/news?page=${page}&limit=${limit}&sort=createdAt&order=desc`);
  }

  // Получить одну новость по ID
  async getNewsById(id) {
    return this.request(`/api/news/${id}`);
  }

  // Создать новость (только для админа)
  async createNews(newsData) {
    return this.request('/api/news', {
      method: 'POST',
      body: JSON.stringify(newsData),
    });
  }

  // Обновить новость (только для админа)
  async updateNews(id, newsData) {
    return this.request(`/api/news/${id}`, {
      method: 'PUT',
      body: JSON.stringify(newsData),
    });
  }

  // Удалить новость (только для админа)
  async deleteNews(id) {
    return this.request(`/api/news/${id}`, {
      method: 'DELETE',
    });
  }

  // Отметить новость как прочитанную
  async markAsRead(newsId) {
    return this.request(`/api/news/${newsId}/read`, {
      method: 'POST',
    });
  }

  // Получить список пользователей, ознакомившихся с новостью
  async getReadUsers(newsId) {
    return this.request(`/api/news/${newsId}/read-users`);
  }

  // Очистить список ознакомившихся (только для админа)
  async clearReadUsers(newsId) {
    return this.request(`/api/news/${newsId}/read-users`, {
      method: 'DELETE',
    });
  }

  // Загрузить изображение для новости
  async uploadImage(file) {
    const formData = new FormData();
    formData.append('image', file);

    const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
    const url = this.buildUrl('/api/news/upload-image');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  }
}

export const newsService = new NewsService();
export default newsService;
