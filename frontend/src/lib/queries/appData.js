import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/apiService';

export const APP_DATA_QUERY_KEY = ['appData'];

export function useAppDataQuery(userKey, options = {}) {
  return useQuery({
    queryKey: [...APP_DATA_QUERY_KEY, userKey || 'anonymous'],
    queryFn: async () => {
      const data = await apiService.request('/api/data', { method: 'GET' });
      return data;
    },
    // Позволяет мгновенно показать ранее загруженные данные из кэша
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    ...options,
  });
}
