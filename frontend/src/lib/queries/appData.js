import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/apiService';

export const APP_DATA_QUERY_KEY = ['appData'];

// Fallback данные на случай ошибок API
const FALLBACK_DATA = {
  system: { 
    version: '1.0.0', 
    currencies: ['aUEC'], 
    baseCurrency: 'aUEC', 
    rates: { aUEC: 1 } 
  },
  warehouse: [],
  showcaseWarehouse: [],
  users: [],
  transactions: [],
  news: [],
  showcase: [],
  directories: {
    accountTypes: [],
    productTypes: [],
    showcaseStatuses: [],
    warehouseTypes: [],
    productNames: []
  },
  nextId: 1
};

export function useAppDataQuery(userKey, options = {}) {
  return useQuery({
    queryKey: [...APP_DATA_QUERY_KEY, userKey || 'anonymous'],
    queryFn: async () => {
      try {
        const data = await apiService.request('/api/data', { method: 'GET' });
        return data;
      } catch (error) {
        console.error('Failed to fetch app data, using fallback:', error);
        // Возвращаем fallback данные вместо выброса ошибки
        return FALLBACK_DATA;
      }
    },
    // Позволяет мгновенно показать ранее загруженные данные из кэша
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 2, // Ограничиваем количество попыток
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000), // Экспоненциальный backoff
    ...options,
  });
}
