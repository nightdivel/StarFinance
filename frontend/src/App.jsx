import React, { useState, useEffect } from 'react';
import { ConfigProvider, theme, message } from 'antd';
import Auth from './components/Auth/Auth.jsx';
import MainLayout from './components/MainLayout.jsx';
import { API_BASE_URL } from './config';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userData, setUserData] = useState(null);
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('theme.dark') === 'true'; } catch (_) { return false; }
  });
  const [isThemeLoaded, setIsThemeLoaded] = useState(false);

  const applyThemeClasses = (isDark) => {
    if (typeof document === 'undefined') return;
    const body = document.body;
    const root = document.querySelector('#root');
    const add = (el, cls) => el && !el.classList.contains(cls) && el.classList.add(cls);
    const remove = (el, cls) => el && el.classList.remove(cls);
    // Remove both first to avoid bleed
    remove(body, 'dark-theme');
    remove(body, 'light-theme');
    if (root) { remove(root, 'dark-theme'); remove(root, 'light-theme'); }
    // Apply target
    if (isDark) {
      add(body, 'dark-theme');
      if (root) add(root, 'dark-theme');
    } else {
      add(body, 'light-theme');
      if (root) add(root, 'light-theme');
    }
  };

  useEffect(() => {
    // Проверка наличия токена в URL (после Discord OAuth)
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    const authStatus = params.get('auth');
    const errCode = params.get('err');
    const errDesc = params.get('desc');
    
    console.log('URL Params:', { token: !!urlToken, authStatus, err: errCode || null, desc: errDesc || null });
    
    if (urlToken) {
      console.log('Found token in URL, attempting authentication...');
      
      // Сохраняем токен
      try { 
        localStorage.setItem('authToken', urlToken);
        console.log('Token saved to localStorage');
      } catch (error) {
        console.error('Failed to save token to localStorage:', error);
      }
      
      // Получаем профиль пользователя
      const profileUrl = `${API_BASE_URL ? API_BASE_URL : ''}/auth/profile`;
      console.log('Fetching profile from:', profileUrl);
      
      fetch(profileUrl, { 
        headers: { 
          'Authorization': `Bearer ${urlToken}`,
          'Accept': 'application/json'
        }
      })
      .then(async (response) => {
        console.log('Profile response status:', response.status);
        const responseText = await response.text();
        
        if (!response.ok) {
          console.error('Profile request failed:', response.status, response.statusText, responseText);
          throw new Error(`Ошибка сервера: ${response.status} ${response.statusText}`);
        }
        
        try {
          return JSON.parse(responseText);
        } catch (e) {
          console.error('Failed to parse profile response:', e, 'Response:', responseText);
          throw new Error('Неверный формат ответа от сервера');
        }
      })
      .then((profile) => {
        console.log('Profile data received:', profile);
        
        if (!profile || !profile.username) {
          throw new Error('Неверный формат профиля пользователя');
        }
        
        const user = {
          username: profile.username,
          accountType: profile.accountType,
          permissions: profile.permissions || {},
          offline: false,
          avatarUrl: profile.avatarUrl || null,
        };
        
        console.log('Setting user data and authentication state');
        setIsAuthenticated(true);
        setUserData(user);
        
        try { 
          localStorage.setItem('userData', JSON.stringify(user));
          console.log('User data saved to localStorage');
        } catch (error) {
          console.error('Failed to save user data to localStorage:', error);
        }
      })
      .catch((error) => {
        console.error('Authentication error:', error);
        // Показываем сообщение об ошибке пользователю
        message.error(error.message || 'Ошибка входа через Discord');
        // Очищаем невалидный токен
        localStorage.removeItem('authToken');
      })
      .finally(() => {
        // Очищаем URL от параметров аутентификации
        const url = new URL(window.location.href);
        url.search = '';
        window.history.replaceState({}, document.title, url.toString());
        console.log('URL cleaned up');
      });
    } else if (authStatus === 'error') {
      // Обработка ошибки аутентификации
      const errorMessage = params.get('message') || 'Неизвестная ошибка аутентификации';
      const details = [errCode, errDesc].filter(Boolean).join(': ');
      if (details) {
        console.error('Authentication error from server:', errorMessage, '| Details:', details);
        message.error(`Ошибка входа: ${errorMessage} (${details})`);
      } else {
        console.error('Authentication error from server:', errorMessage);
        message.error(`Ошибка входа: ${errorMessage}`);
      }
      
      // Очищаем URL от параметров ошибки
      const url = new URL(window.location.href);
      url.search = '';
      window.history.replaceState({}, document.title, url.toString());
    } else {
      // Восстановление локальной сессии
      const token = localStorage.getItem('authToken');
      const savedUserData = localStorage.getItem('userData');
      
      if (token && savedUserData) {
        console.log('Restoring session from localStorage');
        try {
          const user = JSON.parse(savedUserData);
          setIsAuthenticated(true);
          setUserData(user);
          console.log('Session restored successfully');
        } catch (error) {
          console.error('Failed to parse saved user data:', error);
          // Очищаем повреждённые данные
          localStorage.removeItem('authToken');
          localStorage.removeItem('userData');
        }
      } else {
        console.log('No active session found');
      }
    }
  }, [API_BASE_URL]);

  useEffect(() => {
    const doLogout = () => {
      try {
        handleLogout();
      } catch (_) {}
    };

    const onAuthLogout = () => doLogout();
    const onStorage = (e) => {
      if (!e) return;
      if (e.key !== 'authToken' && e.key !== 'userData') return;
      // Если токен удалили/обнулили (в другой вкладке или вручную)
      const token = (() => {
        try { return localStorage.getItem('authToken'); } catch (_) { return null; }
      })();
      if (!token) doLogout();
    };

    const checkToken = () => {
      const token = (() => {
        try { return localStorage.getItem('authToken'); } catch (_) { return null; }
      })();
      if (!token) doLogout();
    };

    window.addEventListener('auth:logout', onAuthLogout);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', checkToken);
    document.addEventListener('visibilitychange', checkToken);

    return () => {
      window.removeEventListener('auth:logout', onAuthLogout);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', checkToken);
      document.removeEventListener('visibilitychange', checkToken);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    applyThemeClasses(!!darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (isAuthenticated) {
      loadUserTheme();
    } else {
      // Для неавторизованных пользователей загружаем тему из localStorage
      const savedTheme = localStorage.getItem('theme.dark') === 'true';
      setDarkMode(savedTheme);
      setIsThemeLoaded(true);
    }
  }, [isAuthenticated]);


  const handleLogout = () => {
    setIsAuthenticated(false);
    setUserData(null);
    localStorage.removeItem('authToken');
    localStorage.removeItem('userData');
    try { localStorage.removeItem('theme.dark'); } catch (_) {}
    // Reset theme to light on logout to avoid bleed
    setDarkMode(false);
    applyThemeClasses(false);
  };

  const handleLogin = async (loginData) => {
    setIsAuthenticated(true);
    setUserData({
      username: loginData.username,
      accountType: loginData.accountType,
      permissions: loginData.permissions || {},
      
    });
    
    // Immediately load and apply server theme after login
    const before = !!darkMode;
    const applied = await loadUserTheme();
    try {
      const guardKey = 'theme.reload.once';
      const already = sessionStorage.getItem(guardKey) === '1';
      if (!already && typeof applied === 'boolean' && applied !== before) {
        sessionStorage.setItem(guardKey, '1');
        window.location.reload();
      }
    } catch (_) {}
  };

  // Сохранение темы на сервере
  const saveThemePreference = async (isDark) => {
    try {
      const token = localStorage.getItem('authToken');
      if (!token) return;

      await fetch(`${API_BASE_URL ? API_BASE_URL : ''}/api/user/theme`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ theme: isDark ? 'dark' : 'light' })
      });
    } catch (error) {
      console.error('Ошибка при сохранении темы на сервере:', error);
    }
  };

  // Загрузка темы пользователя с сервера
  const loadUserTheme = async () => {
    try {
      const token = localStorage.getItem('authToken');
      if (!token) {
        // Если пользователь не авторизован, загружаем тему из localStorage
        const savedTheme = localStorage.getItem('theme.dark') === 'true';
        setDarkMode(savedTheme);
        applyThemeClasses(savedTheme);
        setIsThemeLoaded(true);
        return savedTheme;
      }

      const response = await fetch(`${API_BASE_URL ? API_BASE_URL : ''}/api/user/theme`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        const isDark = data.theme === 'dark';
        setDarkMode(isDark);
        // Сохраняем тему в localStorage для оффлайн-доступа
        try {
          localStorage.setItem('theme.dark', String(isDark));
        } catch (_) {}
        applyThemeClasses(isDark);
        return isDark;
      } else {
        // Если не удалось загрузить тему с сервера, используем локальную
        const savedTheme = localStorage.getItem('theme.dark') === 'true';
        setDarkMode(savedTheme);
        applyThemeClasses(savedTheme);
        return savedTheme;
      }
    } catch (error) {
      console.error('Ошибка при загрузке темы:', error);
      // В случае ошибки используем сохраненную тему
      const savedTheme = localStorage.getItem('theme.dark') === 'true';
      setDarkMode(savedTheme);
      applyThemeClasses(savedTheme);
      return savedTheme;
    } finally {
      setIsThemeLoaded(true);
    }
  };

  const handleToggleTheme = (val) => {
    const isDark = !!val;
    setDarkMode(isDark);
    try {
      localStorage.setItem('theme.dark', String(isDark));
      // Уведомим корневой ThemedApp о смене темы в текущей вкладке
      window.dispatchEvent(new CustomEvent('theme:changed', { detail: { isDark } }));
      // Всегда пытаемся сохранить на сервере (saveThemePreference сам проверит наличие токена)
      saveThemePreference(isDark);
    } catch (_) {}
    applyThemeClasses(isDark);
  };

  const handleUpdateUser = (updated) => {
    setUserData(updated);
    try {
      localStorage.setItem('userData', JSON.stringify(updated));
    } catch (_) {}
  };

  return (
    <ConfigProvider
      theme={{
        algorithm: [theme.compactAlgorithm, darkMode ? theme.darkAlgorithm : theme.defaultAlgorithm],
        token: {
          colorPrimary: '#0f766e',
          colorInfo: '#0f766e',
          fontSize: 14,
          paddingXS: 6,
          paddingSM: 8,
          padding: 12,
          borderRadius: 10,
          colorBgLayout: darkMode ? '#0b1220' : '#f3f6f8',
          colorBorder: darkMode ? '#233042' : '#d7e1e8',
        },
        components: {
          Layout: {
            headerBg: 'transparent',
            bodyBg: 'transparent',
            siderBg: darkMode ? '#0f172a' : '#ffffff',
          },
          Table: {
            cellPaddingBlock: 8,
            cellPaddingInline: 10,
            fontSize: 13,
            headerSplitColor: 'transparent',
            headerBg: darkMode ? '#132033' : '#eef3f6',
            rowHoverBg: darkMode ? 'rgba(45, 212, 191, 0.08)' : '#e9f7f5',
            borderColor: darkMode ? '#22344d' : '#d8e2e8',
          },
          Form: {
            itemMarginBottom: 8,
            verticalLabelPadding: 0,
          },
          Card: {
            padding: 14,
            headerHeight: 42,
            borderRadiusLG: 14,
          },
          Button: {
            controlHeight: 32,
            borderRadius: 10,
          },
          Input: {
            controlHeight: 32,
          },
          Select: {
            controlHeight: 32,
          },
        },
      }}
      componentSize="small"
    >
      <div className={`App ${darkMode ? 'dark-theme' : 'light-theme'}`}>
        {isAuthenticated ? (
          <MainLayout
            userData={userData}
            onLogout={handleLogout}
            onUpdateUser={handleUpdateUser}
            darkMode={darkMode}
            onToggleTheme={handleToggleTheme}
          />
        ) : (
          <Auth onLogin={handleLogin} />
        )}
      </div>
    </ConfigProvider>
  );
}

export default App;
