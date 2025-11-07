import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Card, Alert, Typography, message } from 'antd';
import { UserOutlined, LockOutlined, WifiOutlined, DisconnectOutlined } from '@ant-design/icons';
import AuthService from '../../services/authService';
import './Auth.css';

const { Title, Text } = Typography;
import { API_BASE_URL } from '../../config';
import { apiService } from '../../services/apiService';

const Auth = ({ onLogin }) => {
  const [loading, setLoading] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [serverDiscordEnabled, setServerDiscordEnabled] = useState(false);
  const [discordLoginUrl, setDiscordLoginUrl] = useState('');
  const [authBgUrl, setAuthBgUrl] = useState(null);
  const [form] = Form.useForm();
  const authService = new AuthService();

  useEffect(() => {
    // Проверяем соединение при загрузке
    checkConnection();
    // Подтянем эффективные настройки Discord с сервера (если доступен)
    (async () => {
      try {
        const token = localStorage.getItem('authToken');
        if (token) {
          const headers = { Authorization: `Bearer ${token}` };
          const resp = await fetch(`${API_BASE_URL}/api/system/discord`, { headers });
          if (resp.ok) {
            const data = await resp.json();
            setServerDiscordEnabled(!!data.enable);
            if (data.baseUrl) setDiscordLoginUrl(data.baseUrl);
          }
        }
      } catch (_) {}
      // Публичный флаг (без авторизации) — запасной вариант
      try {
        const respPublic = await fetch(`${API_BASE_URL}/public/discord-enabled`);
        if (respPublic.ok) {
          const d = await respPublic.json();
          if (typeof d.enable === 'boolean') {
            setServerDiscordEnabled((prev) => prev || d.enable);
          }
        }
      } catch (_) {}
      // Получим фон формы авторизации (публичные метаданные)
      try {
        const meta = await apiService.getAuthBackgroundMeta();
        setAuthBgUrl(meta?.url || null);
      } catch (_) {}
    })();
  }, []);

  const checkConnection = async () => {
    try {
      // same-origin via nginx proxy
      await fetch(`${API_BASE_URL}/health`);
      setOfflineMode(false);
    } catch (error) {
      setOfflineMode(true);
    }
  };

  const handleLocalLogin = async (values) => {
    setLoading(true);
    try {
      const response = await authService.loginLocal(values.username, values.password);

      if (response.offline) {
        setOfflineMode(true);
      }

      onLogin(response);
    } catch (error) {
      message.error(error.message || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container" style={authBgUrl ? { backgroundImage: `url(${authBgUrl})` } : undefined}>
      <Card className="auth-card">
        <div className="auth-header">
          <Title level={2}>BLSK Star Finance</Title>
          <Text type="secondary">Система управления финансами и складом</Text>
        </div>

        {offlineMode && (
          <Alert
            message="Оффлайн режим"
            description="Сервер недоступен. Работаем с демо-данными."
            type="warning"
            showIcon
            className="offline-alert"
          />
        )}

        <Form
          form={form}
          name="login"
          onFinish={handleLocalLogin}
          autoComplete="off"
          layout="vertical"
        >
          <Form.Item
            name="username"
            label="Имя пользователя"
            rules={[
              { required: true, message: 'Введите имя пользователя' },
              { min: 3, message: 'Минимум 3 символа' },
            ]}
          >
            <Input prefix={<UserOutlined />} placeholder="admin" size="large" disabled={loading} />
          </Form.Item>

          <Form.Item
            name="password"
            label="Пароль"
            rules={[
              { required: true, message: 'Введите пароль' },
              { min: 1, message: 'Пароль не может быть пустым' },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="admin"
              size="large"
              disabled={loading}
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              loading={loading}
              block
              icon={offlineMode ? <DisconnectOutlined /> : <WifiOutlined />}
            >
              {loading ? 'Вход...' : 'Войти в систему'}
            </Button>
          </Form.Item>
        </Form>

        {/* Блок демо-доступа удален по требованию */}

        {serverDiscordEnabled && (
          <div style={{ marginTop: 16 }}>
            <Button
              size="large"
              block
              onClick={() => {
                const url = discordLoginUrl || `${API_BASE_URL}/auth/discord`;
                window.location.href = url;
              }}
            >
              Войти через Discord
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
};

export default Auth;
