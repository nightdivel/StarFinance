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
  Tabs,
  Modal,
  Upload,
  Checkbox,
} from 'antd';
import { compareDropdownStrings } from '../../utils/helpers';
import { PERMISSIONS } from '../../config/appConfig';

import { SettingOutlined, EditOutlined, DeleteOutlined, HolderOutlined } from '@ant-design/icons';

// Services
import { apiService } from '../../services/apiService';
import { authService } from '../../services/authService';

// Config (нет прямого использования формата валют в этом компоненте)

const { Option } = Select;
const { Title, Text } = Typography;

const MENU_ORDER_DEFAULT = [
  'news',
  'finance',
  'warehouse',
  'showcase',
  'requests',
  'users',
  'directories',
  'uex',
  'tools',
  'settings',
];

const MENU_ORDER_META = {
  news: 'Новости',
  finance: 'Финансы',
  warehouse: 'Склад',
  showcase: 'Витрина',
  requests: 'Заявки',
  users: 'Пользователи',
  directories: 'Справочники',
  uex: 'UEX API',
  tools: 'Инструменты',
  settings: 'Настройки',
};

function normalizeMenuOrder(order) {
  const input = Array.isArray(order) ? order : [];
  const filtered = input.filter((k) => MENU_ORDER_DEFAULT.includes(k));
  const merged = [...filtered, ...MENU_ORDER_DEFAULT.filter((k) => !filtered.includes(k))];
  return merged;
}

const Settings = ({ data, onDataUpdate, onRefresh }) => {
  const [form] = Form.useForm();
  const [accessForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [changedSettings, setChangedSettings] = useState({});
  const [activeSettingsTab, setActiveSettingsTab] = useState('general');
  const [canWrite, setCanWrite] = useState(false);
  const [canManageAccess, setCanManageAccess] = useState(false);
  const [discordScopes, setDiscordScopes] = useState([]);
  const [scopeMappings, setScopeMappings] = useState([]);
  const [accessModalOpen, setAccessModalOpen] = useState(false);
  const [editingAccountType, setEditingAccountType] = useState(null);
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
  // App branding state
  const [systemFaviconUrl, setSystemFaviconUrl] = useState(null);
  const [systemFaviconLoading, setSystemFaviconLoading] = useState(false);
  const [telegramSyncLoading, setTelegramSyncLoading] = useState(false);
  const [discordSyncLoading, setDiscordSyncLoading] = useState(false);
  const [telegramLastSyncAt, setTelegramLastSyncAt] = useState(null);
  const [discordNewsLastSyncAt, setDiscordNewsLastSyncAt] = useState(null);
  const [discordBotTokenConfigured, setDiscordBotTokenConfigured] = useState(false);
  const [menuOrder, setMenuOrder] = useState(MENU_ORDER_DEFAULT);
  const [draggedMenuKey, setDraggedMenuKey] = useState(null);
  const [dropTargetMenuKey, setDropTargetMenuKey] = useState(null);

  const formatSyncTime = (value) => {
    if (!value) return 'еще не выполнялась';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('ru-RU');
  };

  useEffect(() => {
    setCanWrite(authService.hasPermission('settings', 'write'));
    setCanManageAccess(authService.hasPermission('users', 'write'));
  }, []);

  const accountTypes = Array.isArray(data?.directories?.accountTypes)
    ? data.directories.accountTypes
    : [];

  const formatPermissionLabel = (permission) => {
    if (permission === PERMISSIONS.WRITE) return 'Чтение и запись';
    if (permission === PERMISSIONS.READ) return 'Только чтение';
    return 'Нет доступа';
  };

  const openCreateAccountTypeModal = () => {
    setEditingAccountType(null);
    accessForm.resetFields();
    setAccessModalOpen(true);
  };

  const openEditAccountTypeModal = (accountType) => {
    setEditingAccountType(accountType);
    accessForm.setFieldsValue({
      typeName: accountType?.name,
      permissions: accountType?.permissions || {},
      allowedWarehouseTypes: accountType?.allowedWarehouseTypes || [],
    });
    setAccessModalOpen(true);
  };

  const saveAccountType = async () => {
    try {
      const values = await accessForm.validateFields();
      const payload = {
        name: String(values.typeName || '').trim(),
        permissions: values.permissions || {},
        allowedWarehouseTypes: Array.isArray(values.allowedWarehouseTypes)
          ? values.allowedWarehouseTypes
          : [],
      };
      if (!payload.name) {
        message.error('Введите название типа учетной записи');
        return;
      }

      if (editingAccountType?.name) {
        await apiService.updateAccountType(editingAccountType.name, payload);
        message.success('Тип учетной записи обновлен');
      } else {
        await apiService.addAccountType(payload);
        message.success('Тип учетной записи добавлен');
      }

      setAccessModalOpen(false);
      setEditingAccountType(null);
      accessForm.resetFields();
      await onRefresh?.();
    } catch (e) {
      if (e?.errorFields) return;
      message.error('Не удалось сохранить тип учетной записи');
    }
  };

  const removeAccountType = (accountTypeName) => {
    Modal.confirm({
      title: 'Удалить тип учетной записи?',
      content: 'Это действие нельзя отменить.',
      okText: 'Удалить',
      okType: 'danger',
      cancelText: 'Отмена',
      onOk: async () => {
        try {
          await apiService.deleteAccountType(accountTypeName);
          message.success('Тип учетной записи удален');
          await onRefresh?.();
        } catch (_) {
          message.error('Не удалось удалить тип учетной записи');
        }
      },
    });
  };

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
      setMenuOrder(normalizeMenuOrder(data?.system?.menuOrder));
      form.setFieldsValue({
        baseCurrency: data.system.baseCurrency,
        currencies: data.system.currencies,
        rates: data.system.rates,
        appTitle: data.system.appTitle || 'BLSK Star Finance',
        telegramNewsEnabled: data.system.telegramNews?.enabled ?? true,
        telegramNewsChannel: data.system.telegramNews?.channel || 'JamTVStarCitizen',
        telegramNewsSyncMinutes: data.system.telegramNews?.syncMinutes || 15,
        discordNewsEnabled: data.system.discordNews?.enabled ?? false,
        discordNewsChannel: data.system.discordNews?.channel || '',
        discordNewsSyncMinutes: data.system.discordNews?.syncMinutes || 15,
        discordNewsBotToken: '',
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
    // Fetch app branding (public)
    (async () => {
      try {
        const branding = await apiService.getBrandingMeta();
        const title = String(branding?.appTitle || '').trim();
        if (title) {
          form.setFieldValue('appTitle', title);
        }
        const rawUrl = branding?.faviconUrl;
        const normalized = typeof rawUrl === 'string' && rawUrl.startsWith('/')
          ? apiService.buildUrl(rawUrl)
          : rawUrl || null;
        setSystemFaviconUrl(normalized);
      } catch (_) {}
    })();
    // Fetch telegram news settings
    (async () => {
      try {
        const cfg = await apiService.getTelegramNewsSettings();
        form.setFieldsValue({
          telegramNewsEnabled:
            typeof cfg?.enabled === 'boolean' ? cfg.enabled : true,
          telegramNewsChannel: cfg?.channel || 'JamTVStarCitizen',
          telegramNewsSyncMinutes: Number(cfg?.syncMinutes) || 15,
        });
        setTelegramLastSyncAt(cfg?.lastSyncAt || null);
      } catch (_) {}
    })();
    // Fetch discord news settings
    (async () => {
      try {
        const cfg = await apiService.getDiscordNewsSettings();
        form.setFieldsValue({
          discordNewsEnabled:
            typeof cfg?.enabled === 'boolean' ? cfg.enabled : false,
          discordNewsChannel: cfg?.channel || '',
          discordNewsSyncMinutes: Number(cfg?.syncMinutes) || 15,
          discordNewsBotToken: '',
        });
        setDiscordNewsLastSyncAt(cfg?.lastSyncAt || null);
        setDiscordBotTokenConfigured(!!cfg?.botTokenConfigured);
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
    const newAppTitle = String(values.appTitle || '').trim();
    let discordSaved = false;
    let brandingSaved = false;
    let telegramSaved = false;
    let discordNewsSaved = false;
    try {
      if (!newAppTitle) {
        message.warning('Название приложения не может быть пустым');
      } else {
        await apiService.setBranding(newAppTitle);
        brandingSaved = true;
        try {
          const cached = typeof window !== 'undefined' ? localStorage.getItem('appData') : null;
          const appData = cached ? JSON.parse(cached) : data || {};
          const next = {
            ...appData,
            system: {
              ...(appData.system || {}),
              appTitle: newAppTitle,
            },
          };
          if (typeof window !== 'undefined') {
            localStorage.setItem('appData', JSON.stringify(next));
            window.dispatchEvent(new CustomEvent('branding:changed', {
              detail: { appTitle: newAppTitle, faviconUrl: systemFaviconUrl || null },
            }));
          }
        } catch (_) {}
        message.success('Название приложения сохранено');
      }
    } catch (_) {
      message.error('Не удалось сохранить название приложения');
    }

    try {
      const tgEnabled = !!values.telegramNewsEnabled;
      const tgChannel = String(values.telegramNewsChannel || '').trim() || 'JamTVStarCitizen';
      const tgSyncMinutes = Math.max(1, Math.min(360, Number(values.telegramNewsSyncMinutes) || 15));
      await apiService.updateTelegramNewsSettings({
        enabled: tgEnabled,
        channel: tgChannel,
        syncMinutes: tgSyncMinutes,
      });
      telegramSaved = true;
      message.success('Настройки Telegram-новостей сохранены');
    } catch (_) {
      message.error('Не удалось сохранить настройки Telegram-новостей');
    }

    try {
      const dcEnabled = !!values.discordNewsEnabled;
      const dcChannel = String(values.discordNewsChannel || '').trim();
      const dcSyncMinutes = Math.max(1, Math.min(360, Number(values.discordNewsSyncMinutes) || 15));
      const dcBotToken = String(values.discordNewsBotToken || '').trim();
      await apiService.updateDiscordNewsSettings({
        enabled: dcEnabled,
        channel: dcChannel,
        syncMinutes: dcSyncMinutes,
        ...(dcBotToken ? { botToken: dcBotToken } : {}),
      });
      discordNewsSaved = true;
      if (dcBotToken) {
        setDiscordBotTokenConfigured(true);
        form.setFieldValue('discordNewsBotToken', '');
      }
      message.success('Настройки Discord-новостей сохранены');
    } catch (e) {
      const details = e?.json?.details || e?.details || '';
      if (String(details).includes('invalid_channel_reference')) {
        message.error('Некорректный адрес канала Discord. Укажите ID, ссылку на канал или ссылку на сообщение');
      } else {
        message.error('Не удалось сохранить настройки Discord-новостей');
      }
    }

    try {
      await apiService.updateMenuOrder(normalizeMenuOrder(menuOrder));
      message.success('Порядок меню сохранен');
    } catch (_) {
      message.error('Не удалось сохранить порядок меню');
    }

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
    await onRefresh?.();
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
    if ((brandingSaved || telegramSaved || discordNewsSaved) && !discordSaved) {
      // no-op branch keeps save flow explicit and readable for future extensions
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
          appTitle: String(values.appTitle || data.system.appTitle || 'BLSK Star Finance').trim(),
          telegramNews: {
            enabled: !!values.telegramNewsEnabled,
            channel: String(values.telegramNewsChannel || 'JamTVStarCitizen').trim() || 'JamTVStarCitizen',
            syncMinutes: Math.max(1, Math.min(360, Number(values.telegramNewsSyncMinutes) || 15)),
          },
          discordNews: {
            enabled: !!values.discordNewsEnabled,
            channel: String(values.discordNewsChannel || '').trim(),
            syncMinutes: Math.max(1, Math.min(360, Number(values.discordNewsSyncMinutes) || 15)),
            lastSyncAt: discordNewsLastSyncAt || null,
            botTokenConfigured: discordBotTokenConfigured,
          },
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
          menuOrder: normalizeMenuOrder(menuOrder),
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

  const onMenuDragStart = (key) => setDraggedMenuKey(key);

  const onMenuDrop = (targetKey) => {
    if (!draggedMenuKey || draggedMenuKey === targetKey) return;
    setMenuOrder((prev) => {
      const next = [...prev];
      const from = next.indexOf(draggedMenuKey);
      const to = next.indexOf(targetKey);
      if (from < 0 || to < 0) return prev;
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    setChangedSettings((prev) => ({ ...prev, menuOrder: true }));
    setDraggedMenuKey(null);
    setDropTargetMenuKey(null);
  };

  const resetMenuOrder = () => {
    setMenuOrder(MENU_ORDER_DEFAULT);
    setChangedSettings((prev) => ({ ...prev, menuOrder: true }));
  };

  return (
    <div className="p-2">
      <Card>
        <div className="mb-6">
          <Title level={3}>
            <SettingOutlined className="mr-3" />
            Настройки системы
          </Title>
          <Text type="secondary">Управление базовыми настройками и параметрами системы</Text>
        </div>

        {Object.keys(changedSettings).length > 0 && (
          <Alert
            message="Есть несохраненные изменения"
            type="warning"
            showIcon
            className="mb-6"
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
            <Tabs
              className="mb-6"
              activeKey={activeSettingsTab}
              onChange={setActiveSettingsTab}
              items={[
                { key: 'general', label: 'Основные настройки' },
                { key: 'system', label: 'Системные параметры' },
                { key: 'security', label: 'Безопасность' },
              ]}
            />

            {activeSettingsTab === 'general' && (
              <>
            {/* Base Currency Settings */}
            <Card
              title="Основные настройки"
              className="mb-6"
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
              className="mb-6"
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
              <div className="mb-4">
                <Row gutter={16} align="bottom">
                  <Col xs={24} sm={10}>
                    <Form.Item name="newCurrency" label="Добавить валюту">
                      <Input
                        placeholder="Код валюты (например: USD)"
                        className="uppercase"
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
                        className="w-100"
                        disabled={!canWrite}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={4}>
                    <Button type="primary" size="small" onClick={addCurrency} className="w-100" disabled={!canWrite}>
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
                      className="m-1"
                    >
                      {value}
                    </Tag>
                  )}
                  disabled={!canWrite}
                />
              </Form.Item>

              <Divider />

              <div className="mb-2">
                <Text type="secondary">
                  Курсы указаны относительно базовой валюты (
                  {form.getFieldValue('baseCurrency') || data?.system.baseCurrency})
                </Text>
              </div>

              <Form.Item label="Курсы обмена">
                <div className="d-grid gap-3">
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
                              className="w-100"
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

              </>
            )}

            {/* System Settings */}
            {activeSettingsTab === 'system' && (
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
              <Card size="small" title="Подписка Telegram" className="mb-4">
                <Text type="secondary">
                  Укажите канал и параметры подписки. Посты из канала загружаются автоматически в Новости. Первая строка поста используется как заголовок, вторая строка до первой точки — как краткое описание.
                </Text>
                <Row gutter={16} className="mt-3">
                  <Col xs={24} md={8}>
                    <Form.Item name="telegramNewsEnabled" valuePropName="checked" label="Подписка">
                      <Checkbox disabled={!canWrite}>Включить подписку и импорт из Telegram</Checkbox>
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={10}>
                    <Form.Item
                      name="telegramNewsChannel"
                      label="Канал подписки (Telegram)"
                      rules={[{ required: true, message: 'Укажите канал Telegram' }]}
                    >
                      <Input placeholder="JamTVStarCitizen или https://t.me/JamTVStarCitizen" disabled={!canWrite} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={6}>
                    <Form.Item
                      name="telegramNewsSyncMinutes"
                      label="Интервал (минуты)"
                      rules={[{ required: true, message: 'Укажите интервал' }]}
                    >
                      <InputNumber min={1} max={360} className="w-100" disabled={!canWrite} />
                    </Form.Item>
                  </Col>
                </Row>
                <div className="d-flex gap-2 align-items-center flex-wrap">
                  <Button
                    onClick={async () => {
                      setTelegramSyncLoading(true);
                      try {
                        const result = await apiService.syncTelegramNewsNow();
                        const inserted = Number(result?.inserted) || 0;
                        const updated = Number(result?.updated) || 0;
                        const checked = Number(result?.checked) || 0;
                        try {
                          const cfg = await apiService.getTelegramNewsSettings();
                          setTelegramLastSyncAt(cfg?.lastSyncAt || new Date().toISOString());
                        } catch (_) {
                          setTelegramLastSyncAt(new Date().toISOString());
                        }
                        if (inserted > 0 || updated > 0) {
                          message.success(`Синхронизация выполнена. Проверено: ${checked}, добавлено: ${inserted}, обновлено: ${updated}`);
                        } else {
                          message.info(`Синхронизация выполнена. Проверено: ${checked}, новых постов не найдено`);
                        }
                      } catch (_) {
                        message.error('Не удалось выполнить синхронизацию Telegram-новостей');
                      } finally {
                        setTelegramSyncLoading(false);
                      }
                    }}
                    loading={telegramSyncLoading}
                    disabled={!canWrite}
                  >
                    Синхронизировать сейчас
                  </Button>
                  <Text type="secondary">
                    Последняя синхронизация: {formatSyncTime(telegramLastSyncAt)}
                  </Text>
                </div>
              </Card>

              <Card size="small" title="Подписка Discord" className="mb-4">
                <Text type="secondary">
                  Укажите канал и параметры подписки для Discord-новостей. Можно вставить ID, ссылку на канал или ссылку на сообщение из канала.
                </Text>
                <Row gutter={16} className="mt-3">
                  <Col xs={24} md={8}>
                    <Form.Item name="discordNewsEnabled" valuePropName="checked" label="Подписка">
                      <Checkbox disabled={!canWrite}>Включить подписку и импорт из Discord</Checkbox>
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={10}>
                    <Form.Item
                      name="discordNewsChannel"
                      label="Канал подписки (Discord)"
                      rules={[{ required: false }]}
                    >
                      <Input placeholder="ID канала или https://discord.com/channels/.../..." disabled={!canWrite} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={6}>
                    <Form.Item
                      name="discordNewsSyncMinutes"
                      label="Интервал (минуты)"
                      rules={[{ required: true, message: 'Укажите интервал' }]}
                    >
                      <InputNumber min={1} max={360} className="w-100" disabled={!canWrite} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="discordNewsBotToken"
                      label="Токен бота (DISCORD_BOT_TOKEN)"
                      extra="Оставьте пустым, чтобы не изменять текущий токен"
                    >
                      <Input.Password placeholder="Введите Discord bot token" disabled={!canWrite} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12} className="d-flex align-items-end">
                    <Text type="secondary">
                      Токен бота: {discordBotTokenConfigured ? 'настроен' : 'не настроен'}
                    </Text>
                  </Col>
                </Row>
                <div className="d-flex gap-2 align-items-center flex-wrap">
                <Button
                  onClick={async () => {
                    setDiscordSyncLoading(true);
                    try {
                      const result = await apiService.syncDiscordNewsNow();
                      const inserted = Number(result?.inserted) || 0;
                      const updated = Number(result?.updated) || 0;
                      const checked = Number(result?.checked) || 0;
                      try {
                        const cfg = await apiService.getDiscordNewsSettings();
                        setDiscordNewsLastSyncAt(cfg?.lastSyncAt || new Date().toISOString());
                      } catch (_) {
                        setDiscordNewsLastSyncAt(new Date().toISOString());
                      }
                      if (inserted > 0 || updated > 0) {
                        message.success(`Синхронизация Discord выполнена. Проверено: ${checked}, добавлено: ${inserted}, обновлено: ${updated}`);
                      } else {
                        message.info(`Синхронизация Discord выполнена. Проверено: ${checked}, новых постов не найдено`);
                      }
                    } catch (e) {
                      const details = e?.json?.details || e?.details || e?.message || '';
                      if (String(details).includes('channel_not_configured')) {
                        message.error('Укажите ссылку или ID Discord-канала в настройках и сохраните');
                      } else if (String(details).includes('invalid_channel_reference')) {
                        message.error('Укажите корректный адрес канала Discord: ID, ссылку на канал или ссылку на сообщение');
                      } else if (String(details).includes('discord_api_invalid_token')) {
                        message.error('Токен Discord недействителен. Проверьте DISCORD_BOT_TOKEN на сервере');
                      } else if (String(details).includes('discord_oauth_channel_read_denied')) {
                        message.error('Discord отклонил чтение сообщений. Настройте DISCORD_BOT_TOKEN для чтения канала');
                      } else if (String(details).includes('discord_bot_token_required')) {
                        message.error('Для чтения сообщений канала Discord нужен DISCORD_BOT_TOKEN. Добавьте бота в сервер и выдайте права View Channel + Read Message History');
                      } else if (String(details).includes('discord_api_missing_access')) {
                        message.error('Discord отклонил доступ к сообщениям канала. Проверьте права токена/бота на канал');
                      } else if (String(details).includes('discord_auth_not_configured')) {
                        message.error('Задайте DISCORD_BOT_TOKEN на сервере и убедитесь, что бот добавлен в нужный сервер/канал');
                      } else if (String(details).includes('discord_api_unauthorized')) {
                        message.error('Discord отклонил доступ к сообщениям канала. Проверьте права токена на канал');
                      } else {
                        message.error('Не удалось выполнить синхронизацию Discord-новостей');
                      }
                    } finally {
                      setDiscordSyncLoading(false);
                    }
                  }}
                  loading={discordSyncLoading}
                  disabled={!canWrite}
                >
                  Синхронизировать сейчас
                </Button>
                <Text type="secondary">
                  Последняя синхронизация: {formatSyncTime(discordNewsLastSyncAt)}
                </Text>
                </div>
              </Card>

              <Divider />
              <Form.Item
                name="appTitle"
                label="Название приложения"
                rules={[
                  { required: true, message: 'Введите название приложения' },
                  { max: 80, message: 'Максимум 80 символов' },
                ]}
              >
                <Input placeholder="BLSK Star Finance" disabled={!canWrite} />
              </Form.Item>

              <Divider />
              <Title level={5}>Favicon вкладки браузера</Title>
              <Text type="secondary">
                Поддерживаются PNG, SVG, WebP. Максимальный размер файла — 15 MB.
              </Text>
              <div className="mt-3 d-flex gap-3 align-items-center flex-wrap">
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
                    setSystemFaviconLoading(true);
                    try {
                      const reader = new FileReader();
                      const dataUrl = await new Promise((resolve, reject) => {
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(file);
                      });
                      await apiService.setSystemFavicon(String(dataUrl));
                      const branding = await apiService.getBrandingMeta();
                      const rawUrl = branding?.faviconUrl;
                      const normalized = typeof rawUrl === 'string' && rawUrl.startsWith('/')
                        ? apiService.buildUrl(rawUrl)
                        : rawUrl || null;
                      setSystemFaviconUrl(normalized);
                      const titleFromForm = String(form.getFieldValue('appTitle') || '').trim() || 'BLSK Star Finance';
                      window.dispatchEvent(new CustomEvent('branding:changed', {
                        detail: { appTitle: titleFromForm, faviconUrl: normalized || null },
                      }));
                      message.success('Favicon обновлен');
                    } catch (_) {
                      message.error('Не удалось загрузить favicon');
                    } finally {
                      setSystemFaviconLoading(false);
                      e.target.value = '';
                    }
                  }}
                  disabled={!canWrite || systemFaviconLoading}
                />
                <Button
                  danger
                  onClick={async () => {
                    setSystemFaviconLoading(true);
                    try {
                      await apiService.deleteSystemFavicon();
                      setSystemFaviconUrl(null);
                      const titleFromForm = String(form.getFieldValue('appTitle') || '').trim() || 'BLSK Star Finance';
                      window.dispatchEvent(new CustomEvent('branding:changed', {
                        detail: { appTitle: titleFromForm, faviconUrl: null },
                      }));
                      message.success('Favicon удален');
                    } catch (_) {
                      message.error('Не удалось удалить favicon');
                    } finally {
                      setSystemFaviconLoading(false);
                    }
                  }}
                  disabled={!canWrite || systemFaviconLoading || !systemFaviconUrl}
                >
                  Удалить favicon
                </Button>
                {systemFaviconUrl && (
                  <div className="d-flex align-items-center gap-2">
                    <img src={systemFaviconUrl} alt="System favicon" className="sf-maxw-96 sf-maxh-96 sf-object-contain rounded border" />
                    <Button type="primary" size="small" onClick={() => window.open(systemFaviconUrl, '_blank')}>Открыть</Button>
                  </div>
                )}
              </div>

              {/* Auth Background Upload */}
              <Divider />
              <Title level={5}>Фон формы авторизации</Title>
              <Text type="secondary">
                Поддерживаются PNG, SVG, WebP. Максимальный размер файла — 15 MB. Рекомендуемое разрешение: ~1600×900.
              </Text>
              <div className="mt-3 d-flex gap-3 align-items-center flex-wrap">
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
                  <div className="d-flex align-items-center gap-2">
                    <img src={authBgUrl} alt="Auth background" className="sf-maxw-220 sf-maxh-120 sf-object-cover rounded border" />
                    <Button type="primary" size="small" onClick={() => window.open(authBgUrl, '_blank')}>Открыть</Button>
                  </div>
                )}
              </div>

              {/* Auth Icon Upload */}
              <Divider />
              <Title level={5}>Иконка формы авторизации</Title>
              <Text type="secondary">
                Поддерживаются PNG, SVG, WebP. Максимальный размер файла — 15 MB. Иконка отображается над логотипом приложения на форме входа.
              </Text>
              <div className="mt-3 d-flex gap-3 align-items-center flex-wrap">
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
                  <div className="d-flex align-items-center gap-2">
                    <img src={authIconUrl} alt="Auth icon" className="sf-maxw-96 sf-maxh-96 sf-object-contain rounded border" />
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
              <div className="mt-3">
                <Table
                  size="small"
                  tableLayout="auto"
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
                        <div className="p-2" onKeyDown={(e) => e.stopPropagation()}>
                          <Input
                            placeholder="Фильтр по значению"
                            value={selectedKeys[0]}
                            onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
                            onPressEnter={() => confirm()}
                            className="mb-2 block"
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
                <Space className="mt-2">
                  <Button onClick={async () => {
                    try {
                      const token = localStorage.getItem('authToken');
                      const headers = token ? { Authorization: `Bearer ${token}` } : {};
                      const scopesResp = await apiService.request('/api/discord/scopes', { method: 'GET', headers });
                      setDiscordScopes(Array.isArray(scopesResp) ? scopesResp : []);
                    } catch (_) {}
                  }}>Обновить Scopes</Button>
                  <Button type="primary" size="small" onClick={() => { setScopeEditingIndex(null); setScopeModalOpen(true); }} disabled={!canWrite}>Добавить правило</Button>
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

                <Divider />
                <Title level={5}>Настройка меню</Title>
                <Text type="secondary">
                  Меняйте порядок пунктов меню перетаскиванием. Новый порядок сохранится после нажатия «Сохранить».
                </Text>
                <div className="mt-3 d-flex gap-2 flex-wrap align-items-center">
                  <Button onClick={resetMenuOrder} disabled={!canWrite}>Сбросить порядок</Button>
                  <Text type="secondary">Перетаскивайте элементы за иконку слева или за всю строку</Text>
                </div>
                <div className="mt-3">
                  {menuOrder.map((key, idx) => {
                    const isDark = typeof document !== 'undefined' && document.body.classList.contains('dark-theme');
                    const isDragging = draggedMenuKey === key;
                    const isDropTarget = dropTargetMenuKey === key && draggedMenuKey !== key;

                    const palette = isDark
                      ? {
                          baseBg: '#0f172a',
                          baseBorder: '#334155',
                          activeBg: '#1e293b',
                          activeBorder: '#3b82f6',
                          text: '#e2e8f0',
                          muted: '#94a3b8',
                        }
                      : {
                          baseBg: '#ffffff',
                          baseBorder: '#d9d9d9',
                          activeBg: '#f0f5ff',
                          activeBorder: '#1677ff',
                          text: '#1f2937',
                          muted: '#64748b',
                        };

                    return (
                      <div
                        key={key}
                        draggable={canWrite}
                        onDragStart={() => onMenuDragStart(key)}
                        onDragEnter={() => setDropTargetMenuKey(key)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDropTargetMenuKey(key);
                        }}
                        onDragLeave={() => {
                          if (dropTargetMenuKey === key) setDropTargetMenuKey(null);
                        }}
                        onDrop={() => onMenuDrop(key)}
                        onDragEnd={() => {
                          setDraggedMenuKey(null);
                          setDropTargetMenuKey(null);
                        }}
                        style={{
                          border: isDropTarget ? `2px dashed ${palette.activeBorder}` : `1px solid ${palette.baseBorder}`,
                          borderRadius: 10,
                          padding: '10px 12px',
                          marginBottom: 10,
                          background: (isDragging || isDropTarget) ? palette.activeBg : palette.baseBg,
                          cursor: canWrite ? 'grab' : 'default',
                          userSelect: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          boxShadow: isDropTarget ? `0 0 0 2px ${palette.activeBorder}22` : 'none',
                          transition: 'all 120ms ease',
                        }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <HolderOutlined style={{ color: palette.muted, fontSize: 14 }} />
                          <Text style={{ color: palette.muted, marginRight: 2 }}>{idx + 1}.</Text>
                          <Text style={{ color: palette.text }}>{MENU_ORDER_META[key] || key}</Text>
                        </span>
                        <Text style={{ color: palette.muted }}>{isDropTarget ? 'Отпустите для вставки' : '⇅'}</Text>
                      </div>
                    );
                  })}
                </div>
              </div>

              
            </Card>
            )}

            {activeSettingsTab === 'security' && (
              <>
                <Card title="Права доступа" className="mb-6">
                  <Text type="secondary">
                    Управление типами учетных записей и правами доступа по разделам системы.
                  </Text>
                  <div className="mt-3">
                    <Table
                      size="small"
                      rowKey={(r) => r.name}
                      pagination={{ pageSize: 8, showSizeChanger: true }}
                      columns={[
                        {
                          title: 'Тип учетной записи',
                          dataIndex: 'name',
                          key: 'name',
                          width: 220,
                        },
                        {
                          title: 'Права',
                          key: 'permissions',
                          render: (_, record) => {
                            const entries = Object.entries(record.permissions || {});
                            if (!entries.length) return <Text type="secondary">Нет прав</Text>;
                            return (
                              <Space size={[4, 4]} wrap>
                                {entries.map(([resource, permission]) => (
                                  <Tag key={`${record.name}-${resource}`} color={permission === PERMISSIONS.WRITE ? 'green' : permission === PERMISSIONS.READ ? 'blue' : 'default'}>
                                    {resource}: {formatPermissionLabel(permission)}
                                  </Tag>
                                ))}
                              </Space>
                            );
                          },
                        },
                        {
                          title: 'Типы склада',
                          key: 'allowedWarehouseTypes',
                          width: 260,
                          render: (_, record) => {
                            const values = Array.isArray(record.allowedWarehouseTypes)
                              ? record.allowedWarehouseTypes
                              : [];
                            if (!values.length) return <Text type="secondary">Все</Text>;
                            return values.join(', ');
                          },
                        },
                        {
                          title: 'Действия',
                          key: 'actions',
                          width: 120,
                          render: (_, record) => (
                            <Space>
                              <Button
                                size="small"
                                type="text"
                                icon={<EditOutlined />}
                                disabled={!canManageAccess}
                                onClick={() => openEditAccountTypeModal(record)}
                              />
                              <Button
                                size="small"
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                disabled={!canManageAccess}
                                onClick={() => removeAccountType(record.name)}
                              />
                            </Space>
                          ),
                        },
                      ]}
                      dataSource={accountTypes
                        .slice()
                        .sort((a, b) => compareDropdownStrings(a?.name, b?.name))}
                    />
                    <Button
                      type="primary"
                      size="small"
                      onClick={openCreateAccountTypeModal}
                      disabled={!canManageAccess}
                    >
                      Добавить тип учетной записи
                    </Button>
                  </div>
                </Card>

                <Modal
                  title={editingAccountType ? 'Редактирование типа учетной записи' : 'Добавление типа учетной записи'}
                  open={accessModalOpen}
                  onCancel={() => {
                    setAccessModalOpen(false);
                    setEditingAccountType(null);
                    accessForm.resetFields();
                  }}
                  onOk={saveAccountType}
                  okText={editingAccountType ? 'Сохранить' : 'Добавить'}
                  okButtonProps={{ disabled: !canManageAccess }}
                >
                  <Form form={accessForm} layout="vertical">
                    <Form.Item
                      name="typeName"
                      label="Название типа"
                      rules={[{ required: true, message: 'Введите название типа' }]}
                    >
                      <Input placeholder="Напр.: Администратор" />
                    </Form.Item>
                    <Row gutter={16}>
                      {['finance', 'warehouse', 'showcase', 'users', 'directories', 'settings', 'requests', 'news', 'uex', 'tools'].map((resource) => (
                        <Col xs={24} sm={12} key={resource}>
                          <Form.Item name={['permissions', resource]} label={`Права: ${resource === 'uex' ? 'UEX_API' : resource === 'news' ? 'новости' : resource === 'tools' ? 'Инструменты' : resource}`}>
                            <Select placeholder="Выберите права">
                              <Option value={PERMISSIONS.NONE}>Нет доступа</Option>
                              <Option value={PERMISSIONS.READ}>Только чтение</Option>
                              <Option value={PERMISSIONS.WRITE}>Чтение и запись</Option>
                            </Select>
                          </Form.Item>
                        </Col>
                      ))}
                    </Row>
                    <Form.Item name="allowedWarehouseTypes" label="Склад (разрешенные типы)">
                      <Select mode="multiple" placeholder="Выберите типы склада">
                        {(data?.directories?.warehouseTypes || [])
                          .slice()
                          .sort((a, b) => compareDropdownStrings(a, b))
                          .map((item) => (
                            <Option key={item} value={item}>
                              {item}
                            </Option>
                          ))}
                      </Select>
                    </Form.Item>
                  </Form>
                </Modal>
              </>
            )}

            {/* Удалено общее сохранение. Сохранение по разделам выше. */}
          </Form>
        )}
      </Card>
    </div>
  );
};

export default Settings;
