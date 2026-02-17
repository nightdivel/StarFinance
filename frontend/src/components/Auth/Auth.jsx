import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Card, Alert, Typography, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import AuthService from '../../services/authService';
import './Auth.css';

const { Title, Text } = Typography;
import { API_BASE_URL } from '../../config';
import { apiService } from '../../services/apiService';

const Auth = ({ onLogin }) => {
  const [loading, setLoading] = useState(false);
  
  const [serverDiscordEnabled, setServerDiscordEnabled] = useState(false);
  const [discordLoginUrl, setDiscordLoginUrl] = useState('');
  const [authBgUrl, setAuthBgUrl] = useState(null);
  const [authIconUrl, setAuthIconUrl] = useState(null);
  const [form] = Form.useForm();
  const authService = new AuthService();

  useEffect(() => {
    // Узнаем публичный флаг включения Discord-авторизации (без авторизации)
    (async () => {
      try {
        const respPublic = await fetch(`${API_BASE_URL}/public/discord-enabled`);
        if (respPublic.ok) {
          const d = await respPublic.json();
          if (typeof d.enable === 'boolean') {
            setServerDiscordEnabled(!!d.enable);
          }
        }
      } catch (_) {}
      // Получим фон формы авторизации (публичные метаданные)
      try {
        const meta = await apiService.getAuthBackgroundMeta();
        const url = meta?.url;
        const normalized = typeof url === 'string' && url.startsWith('/')
          ? apiService.buildUrl(url)
          : (url || null);
        setAuthBgUrl(normalized);
      } catch (_) {}
      // Получим иконку формы авторизации (публичные метаданные)
      try {
        const metaIcon = await apiService.getAuthIconMeta();
        const url = metaIcon?.url;
        const normalized = typeof url === 'string' && url.startsWith('/')
          ? apiService.buildUrl(url)
          : (url || null);
        setAuthIconUrl(normalized);
      } catch (_) {}
    })();
  }, []);

  

  const handleLocalLogin = async (values) => {
    setLoading(true);
    try {
      const response = await authService.loginLocal(values.username, values.password);

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
          {authIconUrl && (
            <div className="mb-3">
              <img
                src={authIconUrl}
                alt="Auth icon"
                className="max-w-[96px] max-h-[96px] object-contain"
              />
            </div>
          )}
          <Title level={2}>BLSK Star Finance</Title>
          <Text type="secondary">Система управления финансами и складом</Text>
        </div>

        

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
            >
              {loading ? 'Вход...' : 'Войти в систему'}
            </Button>
          </Form.Item>
        </Form>

        {serverDiscordEnabled && (
          <div className="mt-4">
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
