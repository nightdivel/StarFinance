import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Card, Typography, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import AuthService from '../../services/authService';
import { API_BASE_URL } from '../../config';
import { apiService } from '../../services/apiService';
import './Auth.css';

const { Title, Text } = Typography;

const Auth = ({ onLogin, appTitle }) => {
  const [loading, setLoading] = useState(false);
  const [isAuthPreparing, setIsAuthPreparing] = useState(true);
  const [serverDiscordEnabled, setServerDiscordEnabled] = useState(false);
  const [discordLoginUrl, setDiscordLoginUrl] = useState('');
  const defaultAuthBgUrl = `${import.meta.env.BASE_URL}star-citizen-drake-corsair-ucox3arcnaxkfrdm.webp`;
  const defaultAuthIconUrl = `${import.meta.env.BASE_URL}logo.webp`;
  const [authBgUrl, setAuthBgUrl] = useState(defaultAuthBgUrl);
  const [authIconUrl, setAuthIconUrl] = useState(defaultAuthIconUrl);
  const [form] = Form.useForm();
  const authService = new AuthService();
  const effectiveAppTitle = String(appTitle || 'BLSK Star Finance');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const startedAt = Date.now();
      try {
        await Promise.allSettled([
          (async () => {
            try {
              const respPublic = await fetch(`${API_BASE_URL}/public/discord-enabled`);
              if (!respPublic.ok || cancelled) return;
              const d = await respPublic.json();
              if (!cancelled && typeof d.enable === 'boolean') {
                setServerDiscordEnabled(!!d.enable);
              }
            } catch (_) {}
          })(),
          (async () => {
            try {
              const meta = await apiService.getAuthBackgroundMeta();
              const url = meta?.url;
              const normalized = typeof url === 'string' && url.startsWith('/')
                ? apiService.buildUrl(url)
                : (url || null);
              if (!cancelled && normalized) setAuthBgUrl(normalized);
            } catch (_) {}
          })(),
          (async () => {
            try {
              const metaIcon = await apiService.getAuthIconMeta();
              const url = metaIcon?.url;
              const normalized = typeof url === 'string' && url.startsWith('/')
                ? apiService.buildUrl(url)
                : (url || null);
              if (!cancelled && normalized) setAuthIconUrl(normalized);
            } catch (_) {}
          })(),
        ]);
      } finally {
        const elapsed = Date.now() - startedAt;
        const minDelayMs = 550;
        if (elapsed < minDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, minDelayMs - elapsed));
        }
        if (!cancelled) setIsAuthPreparing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!serverDiscordEnabled) {
      setDiscordLoginUrl('');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/discord/url`);
        if (!response.ok || cancelled) return;
        const payload = await response.json();
        if (!cancelled && typeof payload?.url === 'string' && payload.url) {
          setDiscordLoginUrl(payload.url);
        }
      } catch (_) {}
    })();

    return () => {
      cancelled = true;
    };
  }, [serverDiscordEnabled]);

  const handleLocalLogin = async (values) => {
    setLoading(true);
    try {
      const response = await authService.loginLocal(values.username, values.password);
      onLogin(response);
    } catch (error) {
      if (error.message && error.message.includes('заблокирован')) {
        message.error(error.message);
      } else {
        message.error(error.message || 'Ошибка входа');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container" style={authBgUrl ? { backgroundImage: `url(${authBgUrl})` } : undefined}>
      {isAuthPreparing ? (
        <div className="auth-preloader" aria-live="polite">
          <div className="auth-preloader-brand">
            <span className="pit-brand-short">PIT</span>
            <span className="pit-brand-full">Popov Information Technology</span>
          </div>
          <div className="auth-preloader-caption">Подготовка формы авторизации...</div>
        </div>
      ) : null}

      <Card className={`auth-card ${isAuthPreparing ? 'auth-card-hidden' : 'auth-card-ready'}`}>
        <div className="auth-header">
          {authIconUrl && (
            <div className="mb-3">
              <img
                src={authIconUrl}
                alt="Auth icon"
                className="sf-maxw-96 sf-maxh-96 sf-object-contain"
              />
            </div>
          )}
          <div className="pit-brand mb-2" aria-hidden="true">
            <span className="pit-brand-short">PIT</span>
            <span className="pit-brand-full">Popov Information Technology</span>
          </div>
          <Title level={2}>{effectiveAppTitle}</Title>
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
                const currentHash = window.location.hash;
                if (currentHash && currentHash !== '#/') {
                  localStorage.setItem('pendingRedirect', currentHash);
                  console.log('Saved pending redirect before Discord auth:', currentHash);
                }

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
