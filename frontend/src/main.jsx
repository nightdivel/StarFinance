import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ConfigProvider, theme, App as AntdApp } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import App from './App.jsx';
import './index.css';
import './styles/antd-overrides.css';

const root = createRoot(document.getElementById('root'));
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30 * 1000,
    },
  },
});
function ThemedApp() {
  const [isDark, setIsDark] = React.useState(() => {
    try { return localStorage.getItem('theme.dark') === 'true'; } catch { return false; }
  });

  React.useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'theme.dark') setIsDark(e.newValue === 'true');
    };
    const onCustom = (e) => {
      if (e?.detail && typeof e.detail.isDark === 'boolean') setIsDark(!!e.detail.isDark);
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('theme:changed', onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('theme:changed', onCustom);
    };
  }, []);

  return (
    <ConfigProvider
      locale={ruRU}
      componentSize="middle"
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 8,
          fontSize: 14,
          colorBgLayout: isDark ? undefined : '#f6f7f9',
        },
        components: {
          Layout: { headerHeight: 56, headerPadding: '0 16px' },
          Menu: { itemBorderRadius: 6 },
          Card: { borderRadius: 10, headerFontSize: 16 },
          Table: { headerBorderRadius: 8, headerBg: isDark ? undefined : '#fafafa' },
          Button: { borderRadius: 8 },
        },
      }}
    >
      <AntdApp>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <App />
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  );
}

root.render(
  <QueryClientProvider client={queryClient}>
    <ThemedApp />
    <ReactQueryDevtools initialIsOpen={false} />
  </QueryClientProvider>
);
