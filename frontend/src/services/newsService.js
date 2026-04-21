import ApiService from './apiService';
import { APP_CONFIG } from '../config/appConfig.js';

class NewsService {
  constructor() {
    this.apiService = new ApiService();
  }

  async request(endpoint, options = {}) {
    return this.apiService.request(endpoint, options);
  }

  // Получить все новости с пагинацией
  async getNews(page = 1, limit = APP_CONFIG.PAGINATION.NEWS_PAGE_SIZE, source = 'all') {
    const sourceParam = encodeURIComponent(String(source || 'all'));
    return this.request(`/api/news?page=${page}&limit=${limit}&source=${sourceParam}&sort=createdAt&order=desc`);
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
