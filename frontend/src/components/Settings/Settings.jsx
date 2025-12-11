import React, { useState, useEffect } from 'react';
import {
  Card,
  Form,
  Input,
  Select,
  InputNumber,
  Button,
  Switch,
  Divider,
  message,
  Row,
  Col,
  Typography,
  Alert,
  Tag,
  Space,
  Table,
  Modal,
  Upload,
  Checkbox,
} from 'antd';
import { compareDropdownStrings } from '../../utils/helpers';

import { SettingOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';

// Services
import { apiService } from '../../services/apiService';
import { authService } from '../../services/authService';

// Config (нет прямого использования формата валют в этом компоненте)

const { Option } = Select;
const { Title, Text } = Typography;

const Settings = ({ data, onDataUpdate, onRefresh }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [changedSettings, setChangedSettings] = useState({});
  const [canWrite, setCanWrite] = useState(false);
  const [discordScopes, setDiscordScopes] = useState([]);
  const [scopeMappings, setScopeMappings] = useState([]);
  const [attrModalOpen, setAttrModalOpen] = useState(false);
  const [attrEditingIndex, setAttrEditingIndex] = useState(null);
  // Guild mappings UI removed
  const [scopeModalOpen, setScopeModalOpen] = useState(false);
  const [scopeEditingIndex, setScopeEditingIndex] = useState(null);
  
  // Auth background state
  const [authBgUrl, setAuthBgUrl] = useState(null);
  const [authBgLoading, setAuthBgLoading] = useState(false);
  // Auth icon state
  const [authIconUrl, setAuthIconUrl] = useState(null);
  const [authIconLoading, setAuthIconLoading] = useState(false);

  useEffect(() => {
    setCanWrite(authService.hasPermission('settings', 'write'));
  }, []);

  // Reload scopes on opening the scope rule modal to ensure fresh list
  useEffect(() => {
    if (!scopeModalOpen) return;
    (async () => {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const scopesResp = await apiService.request('/api/discord/scopes', { method: 'GET', headers });
        setDiscordScopes(Array.isArray(scopesResp) ? scopesResp : []);
      } catch (_) {}
    })();
  }, [scopeModalOpen]);

  // Initialize form with current data
  React.useEffect(() => {
    if (data) {
      form.setFieldsValue({
        baseCurrency: data.system.baseCurrency,
        currencies: data.system.currencies,
        rates: data.system.rates,
        enableDiscordAuth: data.system.discord?.enable ?? false,
        clientId: data.system.discord?.clientId || '',
        clientSecret: data.system.discord?.clientSecret || '',
        redirectUri: data.system.discord?.redirectUri || '',
        discordAttributeMappings: data.system.discord?.attributeMappings || [],
        defaultAccountType:
          data.system.discord?.defaultAccountType ||
          (Array.isArray(data?.directories?.accountTypes) &&
            data.directories.accountTypes[0]?.name) ||
          '',
        discordGuildMappings: data.system.discord?.guildMappings || [],
      });
    }
  }, [data, form]);

  // Подтянуть актуальные OAuth2-настройки с бэкенда (эффективные: data/system либо .env)
  useEffect(() => {
    const fetchDiscordEffective = async () => {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const resp = await apiService.request('/api/system/discord', { method: 'GET', headers });
        if (resp) {
          form.setFieldsValue({
            enableDiscordAuth: !!resp.enable,
            clientId: resp.clientId || '',
            clientSecret: resp.clientSecret || '',
            redirectUri: resp.redirectUri || '',
            baseUrl: resp.baseUrl || '',
          });
          // Сразу синхронизируем localStorage для кнопки входа
          try {
            const cached = typeof window !== 'undefined' ? localStorage.getItem('appData') : null;
            const appData = cached ? JSON.parse(cached) : data || {};
            const next = {
              ...appData,
              system: {
                ...(appData.system || {}),
                discord: {
                  ...((appData.system || {}).discord || {}),
                  enable: !!resp.enable,
                  clientId: resp.clientId || '',
                  clientSecret: resp.clientSecret || '',
                  redirectUri: resp.redirectUri || '',
                },
              },
            };
            if (typeof window !== 'undefined')
              localStorage.setItem('appData', JSON.stringify(next));
          } catch (_) {}
        }
      } catch (e) {
        // Покажем уведомление только если пользователь явно в разделе настроек
        message.warning(
          'Не удалось загрузить OAuth2-настройки Discord с сервера. Работаете с локальными значениями.'
        );
      }
    };
    fetchDiscordEffective();
    // Fetch current auth background meta (public)
    (async () => {
      try {
        const meta = await apiService.getAuthBackgroundMeta();
        const url = meta?.url;
        const normalized = typeof url === 'string' && url.startsWith('/')
          ? apiService.buildUrl(url)
          : (url || null);
        setAuthBgUrl(normalized);
      } catch (_) {}
    })();
    // Fetch current auth icon meta (public)
    (async () => {
      try {
        const meta = await apiService.getAuthIconMeta();
        const url = meta?.url;
        const normalized = typeof url === 'string' && url.startsWith('/')
          ? apiService.buildUrl(url)
          : (url || null);
        setAuthIconUrl(normalized);
      } catch (_) {}
    })();
    // Загрузим справочник scopes и существующие маппинги
    (async () => {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const [scopesResp, mapResp] = await Promise.all([
          apiService.request('/api/discord/scopes', { method: 'GET', headers }),
          apiService.request('/api/discord/scope-mappings', { method: 'GET', headers }),
        ]);
        setDiscordScopes(Array.isArray(scopesResp) ? scopesResp : []);
        const sortMappings = (arr) => {
          const a = Array.isArray(arr) ? [...arr] : [];
          a.sort((x, y) => {
            const px = x.position == null ? Number.MAX_SAFE_INTEGER : x.position;
            const py = y.position == null ? Number.MAX_SAFE_INTEGER : y.position;
            if (px !== py) return px - py;
            if ((x.value == null) !== (y.value == null)) return (x.value == null ? 1 : 0) - (y.value == null ? 1 : 0);
            if (x.scope !== y.scope) return String(x.scope).localeCompare(String(y.scope));
            return String(x.value || '').localeCompare(String(y.value || ''));
          });
          return a;
        };
        setScopeMappings(sortMappings(mapResp));
      } catch (_) {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle form changes
  const handleValuesChange = (changedValues, allValues) => {
    setChangedSettings((prev) => ({ ...prev, ...changedValues }));
    // Если пользователь переключил Discord-авторизацию, сразу отразим это в localStorage,
    // чтобы кнопка «Войти через Discord» на форме входа реагировала без перезагрузки.
    if (Object.prototype.hasOwnProperty.call(changedValues, 'enableDiscordAuth')) {
      try {
        const cached = typeof window !== 'undefined' ? localStorage.getItem('appData') : null;
        const appData = cached ? JSON.parse(cached) : data || {};
        const next = {
          ...appData,
          system: {
            ...(appData.system || {}),
            discord: {
              ...((appData.system || {}).discord || {}),
              enable: !!changedValues.enableDiscordAuth,
            },
          },
        };
        if (typeof window !== 'undefined') {
          localStorage.setItem('appData', JSON.stringify(next));
        }
      } catch (_) {}
    }
  };

  // Save only base currency related settings
  const saveBaseSettings = async () => {
    try {
      setLoading(true);
      const { baseCurrency, currencies = [], rates = {} } = form.getFieldsValue();
      const base = baseCurrency || data.system.baseCurrency;
      const uniqCurrencies = Array.from(new Set([...(currencies || []), base]));
      const nextRates = Object.fromEntries(
        Object.entries(rates || {}).map(([k, v]) => [
          k,
          v === undefined || v === null ? undefined : parseFloat(String(v).replace(',', '.')),
        ])
      );
      nextRates[base] = 1;
      await apiService.updateCurrenciesConfig({
        currencies: uniqCurrencies,
        baseCurrency: base,
        rates: nextRates,
      });
      await onRefresh?.();
      message.success('Основные настройки сохранены');
      setChangedSettings({});
    } catch (e) {
      message.error('Не удалось сохранить основные настройки');
    } finally {
      setLoading(false);
    }
  };

  // Save only currency list and rates
  const saveCurrencyBlock = async () => {
    try {
      setLoading(true);
      const { currencies = [], rates = {}, baseCurrency } = form.getFieldsValue();
      const base = baseCurrency || data.system.baseCurrency;
      const uniqCurrencies = Array.from(new Set([...(currencies || []), base]));
      const nextRates = Object.fromEntries(
        Object.entries(rates || {}).map(([k, v]) => [
          k,
          v === undefined || v === null ? undefined : parseFloat(String(v).replace(',', '.')),
        ])
      );
      nextRates[base] = 1;
      await apiService.updateCurrenciesConfig({
        currencies: uniqCurrencies,
        baseCurrency: base,
        rates: nextRates,
      });
      await onRefresh?.();
      message.success('Валюты и курсы сохранены');
      setChangedSettings({});
    } catch (e) {
      message.error('Не удалось сохранить валюты/курсы');
    } finally {
      setLoading(false);
    }
  };

  // Save other system params (reuse full save to be safe)
  const saveSystemSettings = async () => {
    const values = form.getFieldsValue();
    setLoading(true);
    let discordSaved = false;
    // Сначала сохраним OAuth2 параметры на бэкенде
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      // Защитимся от перезаписи пустыми значениями: смержим с текущими эффективными
      const currentEffective = {
        enable: form.getFieldValue('enableDiscordAuth'),
        clientId: form.getFieldValue('clientId'),
        clientSecret: form.getFieldValue('clientSecret'),
        redirectUri: form.getFieldValue('redirectUri'),
      };
      const payload = {
        enable:
          typeof values.enableDiscordAuth === 'boolean'
            ? values.enableDiscordAuth
            : !!currentEffective.enable,
        clientId: (values.clientId || currentEffective.clientId || '').trim(),
        clientSecret: (values.clientSecret || currentEffective.clientSecret || '').trim(),
        redirectUri: (values.redirectUri || currentEffective.redirectUri || '').trim(),
        baseUrl: (form.getFieldValue('baseUrl') || '').trim(),
      };
      // Простейшая валидация перед отправкой
      if (payload.enable && (!payload.clientId || !payload.redirectUri)) {
        message.warning('Для включенной Discord-авторизации заполните Client ID и Redirect URI');
      }
      await apiService.request('/api/system/discord', {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      discordSaved = true;
      message.success('OAuth2-настройки Discord сохранены');
    } catch (e) {
      message.error('Не удалось сохранить OAuth2-настройки Discord на сервере');
    }
    // Затем сохраним весь блок настроек в общий data (defaultAccountType, mappings и пр.)
    try {
      await saveSettings(values);
    } finally {
      setLoading(false);
    }
    // Обновим форму эффективными значениями (если сервер доступен)
    if (discordSaved) {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const resp = await apiService.request('/api/system/discord', { method: 'GET', headers });
        if (resp) {
          form.setFieldsValue({
            enableDiscordAuth: !!resp.enable,
            clientId: resp.clientId || '',
            clientSecret: resp.clientSecret || '',
            redirectUri: resp.redirectUri || '',
            baseUrl: resp.baseUrl || '',
          });
        }
      } catch (_) {}
    }
  };

  // Save settings
  const saveSettings = async (values) => {
    setLoading(true);
    try {
      // Ensure base currency is included and has rate 1
      const currenciesFromForm = values.currencies || data.system.currencies || [];
      const base = values.baseCurrency || data.system.baseCurrency;
      const uniqCurrencies = Array.from(new Set([...(currenciesFromForm || []), base]));
      const nextRates = Object.fromEntries(
        Object.entries(values.rates || data.system.rates || {}).map(([k, v]) => [
          k,
          v === undefined || v === null ? undefined : parseFloat(String(v).replace(',', '.')),
        ])
      );
      nextRates[base] = 1;

      const newData = {
        ...data,
        system: {
          ...data.system,
          baseCurrency: base,
          currencies: uniqCurrencies,
          rates: nextRates,
          discord: {
            ...(data.system.discord || {}),
            enable: !!values.enableDiscordAuth,
            attributeMappings: Array.isArray(values.discordAttributeMappings)
              ? values.discordAttributeMappings.filter((m) => m && m.source && m.key)
              : [],
            defaultAccountType: values.defaultAccountType || '',
            guildMappings: Array.isArray(values.discordGuildMappings)
              ? values.discordGuildMappings.filter((m) => m && m.guildId && m.accountType)
              : [],
          },
        },
      };

      const success = await onDataUpdate(newData);
      if (success) {
        message.success('Настройки сохранены');
        setChangedSettings({});
      }
    } catch (error) {
      message.error('Ошибка сохранения настроек');
    } finally {
      setLoading(false);
    }
  };

  // Add new currency
  const addCurrency = () => {
    const newCurrency = (form.getFieldValue('newCurrency') || '').trim().toUpperCase();
    const rateRaw = form.getFieldValue('newCurrencyRate');
    const newCurrencyRate =
      rateRaw === undefined || rateRaw === null
        ? undefined
        : parseFloat(String(rateRaw).replace(',', '.'));

    if (!newCurrency) {
      message.error('Введите код валюты');
      return;
    }
    if (!Number.isFinite(newCurrencyRate) || newCurrencyRate <= 0) {
      message.error('Введите корректный курс (> 0)');
      return;
    }

    const currentCurrencies = form.getFieldValue('currencies') || [];
    if (currentCurrencies.includes(newCurrency)) {
      message.error('Валюта уже существует');
      return;
    }

    const newCurrencies = [...currentCurrencies, newCurrency];
    const newRates = { ...(form.getFieldValue('rates') || {}), [newCurrency]: newCurrencyRate };

    form.setFieldsValue({
      currencies: newCurrencies,
      rates: newRates,
      newCurrency: '',
      newCurrencyRate: undefined,
    });

    setChangedSettings((prev) => ({
      ...prev,
      currencies: newCurrencies,
      rates: newRates,
    }));

    message.success('Валюта добавлена');
  };

  // Remove currency
  const removeCurrency = (currency) => {
    if (currency === form.getFieldValue('baseCurrency')) {
      message.error('Нельзя удалить базовую валюту');
      return;
    }
    Modal.confirm({
      title: 'Удалить валюту?',
      content: 'Это действие нельзя отменить.',
      okText: 'Удалить',
      okType: 'danger',
      cancelText: 'Отмена',
      onOk: () => {
        const currentCurrencies = form.getFieldValue('currencies') || [];
        const newCurrencies = currentCurrencies.filter((c) => c !== currency);
        const newRates = { ...(form.getFieldValue('rates') || {}) };
        delete newRates[currency];

        form.setFieldsValue({
          currencies: newCurrencies,
          rates: newRates,
        });

        setChangedSettings((prev) => ({
          ...prev,
          currencies: newCurrencies,
          rates: newRates,
        }));

        message.success('Валюта удалена');
      },
    });
  };

  // Update exchange rate
  const updateRate = (currency, rate) => {
    const currentRates = form.getFieldValue('rates') || {};
    const newRates = { ...currentRates, [currency]: parseFloat(rate) };

    form.setFieldsValue({ rates: newRates });
    setChangedSettings((prev) => ({ ...prev, rates: newRates }));
  };

  return (
    <div style={{ padding: 8 }}>
      <Card>
        <div style={{ marginBottom: 24 }}>
          <Title level={3}>
            <SettingOutlined style={{ marginRight: 12 }} />
            Настройки системы
          </Title>
          <Text type="secondary">Управление базовыми настройками и параметрами системы</Text>
        </div>

        {Object.keys(changedSettings).length > 0 && (
          <Alert
            message="Есть несохраненные изменения"
            type="warning"
            showIcon
            style={{ marginBottom: 24 }}
            action={
              <Button size="small" onClick={() => form.resetFields()} disabled={!canWrite}>
                Сбросить
              </Button>
            }
          />
        )}

        {!data ? null : (
          <Form
            key={`${data?.system.baseCurrency}-${(data?.system.currencies || []).join(',')}`}
            form={form}
            layout="vertical"
            onFinish={saveSettings}
            onValuesChange={handleValuesChange}
            initialValues={{
              baseCurrency: data?.system.baseCurrency,
              currencies: data?.system.currencies || [],
              rates: data?.system.rates || {},
            }}
          >
            {/* Base Currency Settings */}
            <Card
              title="Основные настройки"
              style={{ marginBottom: 24 }}
              extra={
                <Button
                  type="primary"
                  onClick={saveBaseSettings}
                  loading={loading}
                  disabled={!canWrite}
                >
                  Сохранить
                </Button>
              }
            >
              <Row gutter={24}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="baseCurrency"
                    label="Базовая валюта"
                    rules={[{ required: true, message: 'Выберите базовую валюту' }]}
                  >
                    <Select placeholder="Выберите валюту" disabled={!canWrite}>
                      {(form.getFieldValue('currencies') || data?.system.currencies || [])
                        .slice()
                        .sort((a, b) => compareDropdownStrings(a, b))
                        .map((currency) => (
                          <Option key={currency} value={currency}>
                            {currency}
                          </Option>
                        ))}
                    </Select>
                  </Form.Item>
                </Col>
              </Row>

              

              
            </Card>

            {/* Currency Management + Rates */}
            <Card
              title="Управление валютами"
              style={{ marginBottom: 24 }}
              extra={
                <Button
                  type="primary"
                  onClick={saveCurrencyBlock}
                  loading={loading}
                  disabled={!canWrite}
                >
                  Сохранить
                </Button>
              }
            >
              <div style={{ marginBottom: 16 }}>
                <Row gutter={16} align="bottom">
                  <Col xs={24} sm={10}>
                    <Form.Item name="newCurrency" label="Добавить валюту">
                      <Input
                        placeholder="Код валюты (например: USD)"
                        style={{ textTransform: 'uppercase' }}
                        maxLength={6}
                        disabled={!canWrite}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={10}>
                    <Form.Item
                      name="newCurrencyRate"
                      label={`Курс к базовой (${form.getFieldValue('baseCurrency') || data?.system.baseCurrency})`}
                    >
                      <Input
                        placeholder="1.0000"
                        style={{ width: '100%' }}
                        disabled={!canWrite}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={4}>
                    <Button type="primary" onClick={addCurrency} style={{ width: '100%' }} disabled={!canWrite}>
                      Добавить
                    </Button>
                  </Col>
                </Row>
              </div>

              <Divider />

              <Form.Item name="currencies" label="Доступные валюты">
                <Select
                  mode="multiple"
                  placeholder="Выберите валюты"
                  optionLabelProp="label"
                  popupRender={() => null}
                  tagRender={({ value, closable, onClose }) => (
                    <Tag
                      closable={
                        closable && value !== form.getFieldValue('baseCurrency') && canWrite
                      }
                      onClose={() => removeCurrency(value)}
                      style={{ margin: 4 }}
                    >
                      {value}
                    </Tag>
                  )}
                  disabled={!canWrite}
                />
              </Form.Item>

              <Divider />

              <div style={{ marginBottom: 8 }}>
                <Text type="secondary">
                  Курсы указаны относительно базовой валюты (
                  {form.getFieldValue('baseCurrency') || data?.system.baseCurrency})
                </Text>
              </div>

              <Form.Item label="Курсы обмена">
                <div style={{ display: 'grid', gap: 12 }}>
                  {(form.getFieldValue('currencies') || data?.system.currencies || [])
                    .slice()
                    .sort((a, b) => compareDropdownStrings(a, b))
                    .map((currency) => (
                      <Row key={currency} gutter={16} align="middle">
                        <Col span={6}>
                          <Text strong>{currency}</Text>
                        </Col>
                        <Col span={10}>
                          <Form.Item name={['rates', currency]} noStyle>
                            <Input
                              style={{ width: '100%' }}
                              disabled={
                                !canWrite ||
                                currency ===
                                  (form.getFieldValue('baseCurrency') || data?.system.baseCurrency)
                              }
                              placeholder="1.0000"
                            />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Text type="secondary">
                            1 {currency} ={' '}
                            {(form.getFieldValue('rates') || data?.system.rates || {})[currency] ??
                              1}{' '}
                            {form.getFieldValue('baseCurrency') || data?.system.baseCurrency}
                          </Text>
                        </Col>
                      </Row>
                    )
                  )}
                </div>
              </Form.Item>
            </Card>

            {/* System Settings */}
            <Card
              title="Системные параметры"
              extra={
                <Button
                  type="primary"
                  onClick={saveSystemSettings}
                  loading={loading}
                  disabled={!canWrite}
                >
                  Сохранить
                </Button>
              }
            >
              {/* Auth Background Upload */}
              <Divider />
              <Title level={5}>Фон формы авторизации</Title>
              <Text type="secondary">
                Поддерживаются PNG, SVG, WebP. Максимальный размер файла — 15 MB. Рекомендуемое разрешение: ~1600×900.
              </Text>
              <div style={{ marginTop: 12, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="file"
                  accept="image/png,image/svg+xml,image/webp"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (!/image\/(png|svg\+xml|jpg|webp)/i.test(file.type)) {
                      message.error('Допускаются только PNG/svg/WebP');
                      return;
                    }
                    if (file.size > 15000 * 1024) {
                      message.error('Размер файла превышает 15MB');
                      return;
                    }
                    setAuthBgLoading(true);
                    try {
                      const reader = new FileReader();
                      const dataUrl = await new Promise((resolve, reject) => {
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(file);
                      });
                      await apiService.setAuthBackground(String(dataUrl));
                      const meta = await apiService.getAuthBackgroundMeta();
                      const url = meta?.url;
                      const normalized = typeof url === 'string' && url.startsWith('/')
                        ? apiService.buildUrl(url)
                        : (url || null);
                      setAuthBgUrl(normalized);
                      message.success('Фон обновлён');
                    } catch (err) {
                      message.error('Не удалось загрузить фон');
                    } finally {
                      setAuthBgLoading(false);
                      // reset input value to allow same file reselect
                      e.target.value = '';
                    }
                  }}
                  disabled={!canWrite || authBgLoading}
                />
                <Button
                  danger
                  onClick={async () => {
                    setAuthBgLoading(true);
                    try {
                      await apiService.deleteAuthBackground();
                      setAuthBgUrl(null);
                      message.success('Фон удалён');
                    } catch (_) {
                      message.error('Не удалось удалить фон');
                    } finally { setAuthBgLoading(false); }
                  }}
                  disabled={!canWrite || authBgLoading || !authBgUrl}
                >
                  Удалить фон
                </Button>
                {authBgUrl && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <img src={authBgUrl} alt="Auth background" style={{ maxWidth: 220, maxHeight: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid #eee' }} />
                    <Button type="primary" size="small" onClick={() => window.open(authBgUrl, '_blank')}>Открыть</Button>
                  </div>
                )}
              </div>

              {/* Auth Icon Upload */}
              <Divider />
              <Title level={5}>Иконка формы авторизации</Title>
              <Text type="secondary">
                Поддерживаются PNG, SVG, WebP. Максимальный размер файла — 15 MB. Иконка отображается над логотипом BLSK Star Finance.
              </Text>
              <div style={{ marginTop: 12, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="file"
                  accept="image/png,image/svg+xml,image/webp"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (!/image\/(png|svg\+xml|jpg|webp)/i.test(file.type)) {
                      message.error('Допускаются только PNG/svg/WebP');
                      return;
                    }
                    if (file.size > 15000 * 1024) {
                      message.error('Размер файла превышает 15MB');
                      return;
                    }
                    setAuthIconLoading(true);
                    try {
                      const reader = new FileReader();
                      const dataUrl = await new Promise((resolve, reject) => {
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(file);
                      });
                      
                      // Логируем для отладки
                      console.log('Sending auth icon dataUrl length:', dataUrl.length);
                      console.log('Data URL prefix:', dataUrl.substring(0, 50));
                      
                      await apiService.setAuthIcon(String(dataUrl));
                      const meta = await apiService.getAuthIconMeta();
                      const url = meta?.url;
                      const normalized = typeof url === 'string' && url.startsWith('/')
                        ? apiService.buildUrl(url)
                        : (url || null);
                      setAuthIconUrl(normalized);
                      message.success('Иконка обновлена');
                    } catch (err) {
                      console.error('Error uploading auth icon:', err);
                      const errorMsg = err?.body || err?.message || 'Не удалось загрузить иконку';
                      message.error(`Ошибка: ${errorMsg}`);
                    } finally {
                      setAuthIconLoading(false);
                      e.target.value = '';
                    }
                  }}
                  disabled={!canWrite || authIconLoading}
                />
                <Button
                  danger
                  onClick={async () => {
                    setAuthIconLoading(true);
                    try {
                      await apiService.deleteAuthIcon();
                      setAuthIconUrl(null);
                      message.success('Иконка удалена');
                    } catch (_) {
                      message.error('Не удалось удалить иконку');
                    } finally { setAuthIconLoading(false); }
                  }}
                  disabled={!canWrite || authIconLoading || !authIconUrl}
                >
                  Удалить иконку
                </Button>
                {authIconUrl && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <img src={authIconUrl} alt="Auth icon" style={{ maxWidth: 96, maxHeight: 96, objectFit: 'contain', borderRadius: 8, border: '1px solid #eee' }} />
                    <Button type="primary" size="small" onClick={() => window.open(authIconUrl, '_blank')}>Открыть</Button>
                  </div>
                )}
              </div>
              <Row gutter={24}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="enableDiscordAuth"
                    label="Авторизация через Discord"
                    valuePropName="checked"
                  >
                    <Checkbox disabled={!canWrite}>Включить</Checkbox>
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={24}>
                <Col xs={24} md={8}>
                  <Form.Item name="clientId" label="Client ID">
                    <Input placeholder="1419..." disabled={!canWrite} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="clientSecret" label="Client Secret">
                    <Input.Password placeholder="секрет приложения" disabled={!canWrite} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="redirectUri" label="Redirect URI">
                    <Input
                      placeholder={`${window.location.origin}/auth/discord/callback`}
                      disabled={!canWrite}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={24}>
                <Col xs={24}>
                  <Form.Item name="baseUrl" label="Base URL (Discord OAuth)" tooltip="Адрес авторизации Discord OAuth. Можно отредактировать вручную или оставить пустым для авто-генерации.">
                    <Input
                      addonAfter={
                        <Button type="primary" size="small" onClick={() => {
                          const v = form.getFieldValue('baseUrl') || '';
                          if (v) navigator.clipboard.writeText(v);
                        }}>Копировать</Button>
                      }
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Divider />
              <Title level={5}>Маппинг по Discord Scopes</Title>
              <Text type="secondary">
                Настройте назначение типа учетной записи по наличию выданных приложению Discord
                прав (scope). Поле «Значение» — необязательно.
              </Text>
              <div style={{ marginTop: 12 }}>
                <Table
                  size="small"
                  rowKey={(r, idx) => `${r.scope}|${r.value ?? ''}|${idx}`}
                  columns={[
                    {
                      title: 'Позиция', dataIndex: 'position', key: 'position', width: 100,
                      render: (v) => (v == null ? '-' : v),
                      sorter: (a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER),
                    },
                    {
                      title: 'Scope', dataIndex: 'scope', key: 'scope', width: 240,
                      filters: (discordScopes || []).map((s) => ({ text: s, value: s })),
                      onFilter: (val, r) => r.scope === val,
                    },
                    {
                      title: 'Значение', dataIndex: 'value', key: 'value', width: 220,
                      filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
                        <div style={{ padding: 8 }} onKeyDown={(e) => e.stopPropagation()}>
                          <Input
                            placeholder="Фильтр по значению"
                            value={selectedKeys[0]}
                            onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
                            onPressEnter={() => confirm()}
                            style={{ marginBottom: 8, display: 'block' }}
                          />
                          <Space>
                            <Button type="primary" size="small" onClick={() => confirm()}>Найти</Button>
                            <Button size="small" onClick={() => { clearFilters?.(); confirm(); }}>Сбросить</Button>
                          </Space>
                        </div>
                      ),
                      onFilter: (v, r) => (r.value || '').toLowerCase().includes(String(v).toLowerCase()),
                    },
                    {
                      title: 'Тип учетной записи', dataIndex: 'account_type', key: 'account_type', width: 240,
                      filters: (Array.isArray(data?.directories?.accountTypes) ? data.directories.accountTypes : []).map((t) => ({ text: t.name, value: t.name })),
                      onFilter: (v, r) => r.account_type === v,
                    },
                    {
                      title: 'Действия', key: 'actions', width: 200, fixed: 'right',
                      render: (_, m, idx) => (
                        <Space>
                          <Button size="small" onClick={async () => {
                            if (idx <= 0) return;
                            try {
                              const token = localStorage.getItem('authToken');
                              const headers = token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
                              const above = scopeMappings[idx - 1];
                              const cur = scopeMappings[idx];
                              // используем текущий визуальный порядок как базовый, если позиция не задана на сервере
                              const posAbove = above.position ?? idx;      // элемент выше (idx-1) должен иметь позицию idx (1-базная нумерация)
                              const posCur = cur.position ?? (idx + 1);    // текущий элемент (idx) имеет позицию idx+1
                              // swap positions by upserting both
                              await apiService.request('/api/discord/scope-mappings', { method: 'POST', headers, body: JSON.stringify({ scope: cur.scope, value: cur.value ?? null, accountType: cur.account_type, position: posAbove }) });
                              await apiService.request('/api/discord/scope-mappings', { method: 'POST', headers, body: JSON.stringify({ scope: above.scope, value: above.value ?? null, accountType: above.account_type, position: posCur }) });
                              // update local state
                              setScopeMappings((prev) => {
                                const next = [...prev];
                                next[idx - 1] = { ...above, position: posCur };
                                next[idx] = { ...cur, position: posAbove };
                                next.sort((x, y) => (x.position ?? Number.MAX_SAFE_INTEGER) - (y.position ?? Number.MAX_SAFE_INTEGER));
                                return next;
                              });
                            } catch (_) { message.error('Не удалось изменить порядок'); }
                          }} disabled={!canWrite || idx === 0}>Вверх</Button>
                          <Button size="small" onClick={async () => {
                            if (idx >= scopeMappings.length - 1) return;
                            try {
                              const token = localStorage.getItem('authToken');
                              const headers = token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
                              const below = scopeMappings[idx + 1];
                              const cur = scopeMappings[idx];
                              // используем текущий визуальный порядок как базовый, если позиция не задана на сервере
                              const posCur = cur.position ?? (idx + 1);      // текущий элемент (idx) имеет позицию idx+1
                              const posBelow = below.position ?? (idx + 2);  // нижний элемент (idx+1) имеет позицию idx+2
                              await apiService.request('/api/discord/scope-mappings', { method: 'POST', headers, body: JSON.stringify({ scope: cur.scope, value: cur.value ?? null, accountType: cur.account_type, position: posBelow }) });
                              await apiService.request('/api/discord/scope-mappings', { method: 'POST', headers, body: JSON.stringify({ scope: below.scope, value: below.value ?? null, accountType: below.account_type, position: posCur }) });
                              setScopeMappings((prev) => {
                                const next = [...prev];
                                next[idx] = { ...cur, position: posBelow };
                                next[idx + 1] = { ...below, position: posCur };
                                next.sort((x, y) => (x.position ?? Number.MAX_SAFE_INTEGER) - (y.position ?? Number.MAX_SAFE_INTEGER));
                                return next;
                              });
                            } catch (_) { message.error('Не удалось изменить порядок'); }
                          }} disabled={!canWrite || idx === scopeMappings.length - 1}>Вниз</Button>
                          <Button size="small" type="text" icon={<EditOutlined />} onClick={() => { setScopeEditingIndex(idx); setScopeModalOpen(true); }} disabled={!canWrite} />
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={!canWrite} onClick={async () => {
                            Modal.confirm({
                              title: 'Удалить правило?',
                              content: 'Это действие нельзя отменить.',
                              okText: 'Удалить',
                              okType: 'danger',
                              cancelText: 'Отмена',
                              onOk: async () => {
                                try {
                                  const token = localStorage.getItem('authToken');
                                  const headers = token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
                                  const params = new URLSearchParams({ scope: m.scope });
                                  if (m.value) params.append('value', m.value);
                                  await apiService.request(`/api/discord/scope-mappings?${params.toString()}`, { method: 'DELETE', headers });
                                  setScopeMappings((prev) => prev.filter((_, i) => i !== idx));
                                  message.success('Правило удалено');
                                } catch (e) { message.error('Не удалось удалить правило'); }
                              }
                            });
                          }} />
                        </Space>
                      ),
                    }
                  ]}
                  dataSource={scopeMappings}
                  pagination={{ pageSize: 10, showSizeChanger: true }}
                />
                <Space style={{ marginTop: 8 }}>
                  <Button onClick={async () => {
                    try {
                      const token = localStorage.getItem('authToken');
                      const headers = token ? { Authorization: `Bearer ${token}` } : {};
                      const scopesResp = await apiService.request('/api/discord/scopes', { method: 'GET', headers });
                      setDiscordScopes(Array.isArray(scopesResp) ? scopesResp : []);
                    } catch (_) {}
                  }}>Обновить Scopes</Button>
                  <Button type="primary" onClick={() => { setScopeEditingIndex(null); setScopeModalOpen(true); }} disabled={!canWrite}>Добавить правило</Button>
                </Space>
                <Modal
                  title={scopeEditingIndex !== null ? 'Редактирование scope-правила' : 'Добавление scope-правила'}
                  open={scopeModalOpen}
                  onCancel={() => setScopeModalOpen(false)}
                  onOk={async () => {
                    try {
                      const token = localStorage.getItem('authToken');
                      const headers = token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
                      if (scopeEditingIndex !== null) {
                        // edit mode
                        const original = scopeMappings[scopeEditingIndex];
                        const newScope = form.getFieldValue('scopeEdit');
                        const newValue = form.getFieldValue('valueEdit') || null;
                        const newAccountType = form.getFieldValue('accountTypeEdit');
                        // if scope/value changed, delete old first
                        if (original.scope !== newScope || (original.value || null) !== (newValue || null)) {
                          const params = new URLSearchParams({ scope: original.scope });
                          if (original.value) params.append('value', original.value);
                          await apiService.request(`/api/discord/scope-mappings?${params.toString()}`, { method: 'DELETE', headers });
                        }
                        await apiService.request('/api/discord/scope-mappings', {
                          method: 'POST',
                          headers,
                          body: JSON.stringify({ scope: newScope, value: newValue, accountType: newAccountType, position: original.position ?? undefined }),
                        });
                        setScopeMappings((prev) => {
                          const next = [...prev];
                          next[scopeEditingIndex] = { scope: newScope, value: newValue, account_type: newAccountType, position: original.position };
                          next.sort((x, y) => (x.position ?? Number.MAX_SAFE_INTEGER) - (y.position ?? Number.MAX_SAFE_INTEGER));
                          return next;
                        });
                      } else {
                        // add mode
                        const payload = {
                          scope: form.getFieldValue('scopeNew'),
                          value: form.getFieldValue('valueNew') || null,
                          accountType: form.getFieldValue('accountTypeNew'),
                        };
                        await apiService.request('/api/discord/scope-mappings', { method: 'POST', headers, body: JSON.stringify(payload) });
                        setScopeMappings((prev) => {
                          const next = [...prev, { scope: payload.scope, value: payload.value ?? null, account_type: payload.accountType }];
                          next.sort((x, y) => (x.position ?? Number.MAX_SAFE_INTEGER) - (y.position ?? Number.MAX_SAFE_INTEGER));
                          return next;
                        });
                      }
                      message.success('Правило сохранено');
                      setScopeModalOpen(false);
                    } catch (e) { message.error('Не удалось сохранить правило'); }
                  }}
                  okButtonProps={{ disabled: !canWrite }}
                >
                  {scopeEditingIndex !== null ? (
                    <Form layout="vertical" form={form} initialValues={{
                      scopeEdit: scopeMappings[scopeEditingIndex]?.scope,
                      valueEdit: scopeMappings[scopeEditingIndex]?.value || '',
                      accountTypeEdit: scopeMappings[scopeEditingIndex]?.account_type,
                    }}>
                      <Form.Item name="scopeEdit" label="Scope" rules={[{ required: true }]}> 
                        <Select
                          showSearch
                          placeholder="Выберите scope"
                          optionFilterProp="label"
                          filterOption={(input, option) => (option?.label || '').toLowerCase().includes(input.toLowerCase())}
                          options={(discordScopes || []).map((s) => ({ label: s, value: s }))}
                        />
                      </Form.Item>
                      <Form.Item name="valueEdit" label="Значение (необязательно)">
                        <Input />
                      </Form.Item>
                      <Form.Item name="accountTypeEdit" label="Тип учетной записи" rules={[{ required: true }]}> 
                        <Select>
                          {(Array.isArray(data?.directories?.accountTypes) ? data.directories.accountTypes : []).map((t) => (
                            <Option key={t.name} value={t.name}>{t.name}</Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Form>
                  ) : (
                    <Form layout="vertical" form={form}>
                      <Form.Item name="scopeNew" label="Scope" rules={[{ required: true }]}> 
                        <Select
                          showSearch
                          placeholder="Выберите scope"
                          optionFilterProp="label"
                          filterOption={(input, option) => (option?.label || '').toLowerCase().includes(input.toLowerCase())}
                          options={(discordScopes || []).map((s) => ({ label: s, value: s }))}
                        />
                      </Form.Item>
                      <Form.Item name="valueNew" label="Значение (необязательно)">
                        <Input />
                      </Form.Item>
                      <Form.Item name="accountTypeNew" label="Тип учетной записи" rules={[{ required: true }]}> 
                        <Select>
                          {(Array.isArray(data?.directories?.accountTypes) ? data.directories.accountTypes : []).map((t) => (
                            <Option key={t.name} value={t.name}>{t.name}</Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Form>
                  )}
                </Modal>
              </div>

              
            </Card>

            {/* Удалено общее сохранение. Сохранение по разделам выше. */}
          </Form>
        )}
      </Card>
    </div>
  );
};

export default Settings;
