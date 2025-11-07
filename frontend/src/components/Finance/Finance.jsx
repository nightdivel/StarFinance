import React, { useEffect, useMemo, useState } from 'react';
import {
  Card,
  Button,
  Modal,
  Form,
  Input,
  Select,
  AutoComplete,
  Statistic,
  Tag,
  message,
} from 'antd';
import { Tooltip } from 'antd';
import { PlusOutlined, ArrowUpOutlined, ArrowDownOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import TableWithFullscreen from '../common/TableWithFullscreen';
import { Responsive, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useQueryClient } from '@tanstack/react-query';
import { APP_DATA_QUERY_KEY } from '../../lib/queries/appData';
import { getSocket } from '../../lib/realtime/socket';

// Services
import { apiService } from '../../services/apiService';
import { authService } from '../../services/authService';

// Config
import { CURRENCY_FORMAT } from '../../config/appConfig';

const { Option } = Select;
const { TextArea } = Input;

const ResponsiveGridLayout = WidthProvider(Responsive);

const Finance = ({ data, onDataUpdate: _onDataUpdate, onRefresh, userData }) => {
  const queryClient = useQueryClient();
  const [transactionModalVisible, setTransactionModalVisible] = useState(false);
  const [txSearch, setTxSearch] = useState('');
  const [editingTx, setEditingTx] = useState(null);
  const [financeRequests, setFinanceRequests] = useState([]);
  

  // Убрали внешние фильтры — используем фильтры в заголовках таблиц

  const [transactionForm] = Form.useForm();
  const txType = Form.useWatch('type', transactionForm);
  const isAdmin = authService.hasPermission('users', 'write') || (userData?.accountType === 'Администратор');

  // При смене типа операции очищаем контрагента, чтобы избежать некорректного значения
  useEffect(() => {
    try {
      transactionForm.setFieldsValue({ counterparty: null });
    } catch (_) {}
  }, [txType]);

  // Расчёт балансов будет ниже, после определения вспомогательных функций преобразования пользователей

  // Layout persistence helpers
  const layoutStorageKey = useMemo(() => {
    const user = userData?.username || 'anonymous';
    return `layout.finance.${user}`;
  }, [userData?.username]);

  const defaultLayouts = {
    lg: [
      { i: 'stats', x: 0, y: 0, w: 12, h: 6, minW: 6, minH: 4 },
      { i: 'transactions', x: 0, y: 6, w: 8, h: 20, minW: 7, minH: 12 },
      { i: 'currencies', x: 8, y: 6, w: 4, h: 20, minW: 3, minH: 10 },
      { i: 'txRequests', x: 0, y: 26, w: 12, h: 14, minW: 8, minH: 10 },
    ],
    md: [
      { i: 'stats', x: 0, y: 0, w: 10, h: 6, minW: 5, minH: 4 },
      { i: 'transactions', x: 0, y: 6, w: 10, h: 20, minW: 7, minH: 12 },
      { i: 'currencies', x: 0, y: 26, w: 10, h: 16, minW: 5, minH: 10 },
      { i: 'txRequests', x: 0, y: 42, w: 10, h: 14, minW: 7, minH: 10 },
    ],
    sm: [
      { i: 'stats', x: 0, y: 0, w: 6, h: 6, minW: 4, minH: 4 },
      { i: 'transactions', x: 0, y: 6, w: 6, h: 20, minW: 4, minH: 12 },
      { i: 'currencies', x: 0, y: 26, w: 6, h: 16, minW: 3, minH: 10 },
      { i: 'txRequests', x: 0, y: 42, w: 6, h: 14, minW: 4, minH: 10 },
    ],
    xs: [
      { i: 'stats', x: 0, y: 0, w: 4, h: 6, minW: 3, minH: 4 },
      { i: 'transactions', x: 0, y: 6, w: 4, h: 20, minW: 3, minH: 12 },
      { i: 'currencies', x: 0, y: 26, w: 4, h: 16, minW: 3, minH: 10 },
      { i: 'txRequests', x: 0, y: 42, w: 4, h: 14, minW: 3, minH: 10 },
    ],
    xxs: [
      { i: 'stats', x: 0, y: 0, w: 2, h: 6, minW: 2, minH: 4 },
      { i: 'transactions', x: 0, y: 6, w: 2, h: 20, minW: 2, minH: 12 },
      { i: 'currencies', x: 0, y: 26, w: 2, h: 16, minW: 2, minH: 10 },
      { i: 'txRequests', x: 0, y: 42, w: 2, h: 14, minW: 2, minH: 10 },
    ],
  };

  const [layouts, setLayouts] = useState(() => {
    try {
      const raw = localStorage.getItem(layoutStorageKey);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return defaultLayouts;
  });

  // Load server-saved layouts for user
  useEffect(() => {
    (async () => {
      try {
        const resp = await apiService.getUserLayouts('finance');
        if (resp && resp.layouts) {
          setLayouts(resp.layouts);
          try { localStorage.setItem(layoutStorageKey, JSON.stringify(resp.layouts)); } catch (_) {}
        }
      } catch (_) {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData?.id]);

  const handleLayoutChange = (current, allLayouts) => {
    setLayouts(allLayouts);
    try {
      localStorage.setItem(layoutStorageKey, JSON.stringify(allLayouts));
    } catch (_) {}
    // Persist to server (best-effort)
    try { apiService.saveUserLayouts('finance', allLayouts); } catch (_) {}
  };

  const handleResetLayout = () => {
    setLayouts(defaultLayouts);
    try { localStorage.removeItem(layoutStorageKey); } catch (_) {}
  };

  // Server-time date formatter (UTC) with Russian format dd.MM.yyyy HH:mm:ss
  const formatServerDate = (isoLike) => {
    if (!isoLike) return '-';
    const d = new Date(isoLike);
    if (Number.isNaN(d.getTime())) return '-';
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'UTC', // показываем серверное время (UTC из ISO)
    }).format(d);
  };

  // Format currency
  const formatCurrency = (amount, currency) => {
    const config = CURRENCY_FORMAT[currency] || {
      precision: 2,
      thousandSeparator: ' ',
      decimalSeparator: '.',
    };

    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: config.precision,
      maximumFractionDigits: config.precision,
    }).format(amount);
  };

  // Create or update transaction
  const addTransaction = async (values) => {
    try {
      const me = (userData?.username || '').trim();
      const cp = (values.counterparty || '').trim();
      // Require counterparty depending on type, EXCEPT: admin + income => optional
      if (!cp) {
        if (values.type === 'income' && isAdmin) {
          // allow empty sender for admins on income
        } else if (values.type === 'income') {
          message.error('Укажите отправителя (username) для входящей операции');
          return;
        } else if (values.type === 'outcome') {
          message.error('Укажите получателя (username) для исходящей операции');
          return;
        } else {
          message.error('Укажите тип операции и контрагента');
          return;
        }
      }
      // Ограничение: входящую "самому себе" может создать только Администратор
      if (
        values.type === 'income' &&
        cp &&
        me &&
        cp.toLowerCase() === me.toLowerCase() &&
        !isAdmin
      ) {
        message.error('Только Администратор может создать входящую транзакцию самому себе');
        return;
      }
      // Validation: для исходящих операций получатель не должен совпадать с текущим пользователем
      if (values.type === 'outcome' && cp && cp.toLowerCase() === me.toLowerCase()) {
        message.error('Получатель не может совпадать с текущим пользователем для исходящей операции');
        return;
      }
      const payload = {
        ...(editingTx?.id ? { id: editingTx.id } : {}),
        type: values.type,
        amount: parseFloat(values.amount),
        currency: values.currency,
        // Map based on operation type:
        // income: current user is recipient (to_user = me), sender from_user = cp
        // outcome: current user is sender (from_user = me), recipient to_user = cp
        ...(values.type === 'income'
          ? { from_user: cp || null, to_user: me || null }
          : { to_user: cp || null, from_user: me || null }),
        meta: values.desc ? { desc: values.desc } : undefined,
      };
      await apiService.saveTransaction(payload);
      transactionForm.resetFields();
      setTransactionModalVisible(false);
      setEditingTx(null);
      await queryClient.invalidateQueries({ queryKey: APP_DATA_QUERY_KEY });
      // Обновим список заявок по транзакциям (на случай если сокет не пришёл)
      try { await loadFinanceRequests(); } catch (_) {}
    } catch (error) {
      message.error(editingTx ? 'Ошибка обновления транзакции' : 'Ошибка добавления транзакции');
    }
  };

  // Currency management functions would be implemented here...

  

  const currencyColumns = [
    {
      title: 'Валюта',
      dataIndex: 'currency',
      key: 'currency',
      width: 120,
      align: 'center',
    },
    {
      title: 'Курс (1 ед. к базовой)',
      key: 'rate',
      width: 200,
      align: 'center',
      render: (_, record) => {
        const base = data.system.baseCurrency;
        if (record.currency === base) return `1 ${base} = 1 ${base}`;
        const rate = Number(data.system.rates[record.currency] || 1);
        return `1 ${record.currency} = ${rate} ${base}`;
      },
    },
  ];

  const frColumns = [
    {
      title: 'Дата',
      key: 'created_at',
      width: 180,
      align: 'center',
      render: (_, record) => formatServerDate(record.created_at || record.createdAt),
      sorter: (a, b) => new Date(a.created_at || a.createdAt) - new Date(b.created_at || b.createdAt),
    },
    {
      title: 'Отправитель',
      dataIndex: 'from_user',
      key: 'from_user',
      width: 160,
      align: 'center',
      render: (v) => toUsername(v) || '-',
    },
    {
      title: 'Получатель',
      dataIndex: 'to_user',
      key: 'to_user',
      width: 160,
      align: 'center',
      render: (v) => toUsername(v) || '-',
    },
    {
      title: 'Сумма',
      key: 'amount',
      width: 160,
      align: 'right',
      render: (_, r) => `${formatCurrency(r.amount, r.currency)} ${r.currency}`,
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      align: 'center',
      render: (st) => <Tag color={st === 'Выполнено' ? 'green' : st === 'Отменена' ? 'red' : 'orange'}>{st}</Tag>,
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 220,
      align: 'center',
      render: (_, r) => {
        const canAct = r.status === 'В обработке' && isRecipient(r);
        return (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <Button size="small" type="primary" disabled={!canAct} onClick={async () => { await apiService.confirmFinanceRequest(r.id); await queryClient.invalidateQueries({ queryKey: APP_DATA_QUERY_KEY }); await loadFinanceRequests(); }}>Подтвердить</Button>
            <Button size="small" danger disabled={!canAct} onClick={async () => { await apiService.cancelFinanceRequest(r.id); await queryClient.invalidateQueries({ queryKey: APP_DATA_QUERY_KEY }); await loadFinanceRequests(); }}>Отменить</Button>
          </div>
        );
      },
    },
  ];

  // Таблица транзакций: фильтры в заголовках
  // Добавим фильтрацию по валюте в заголовке
  const usernames = useMemo(() => (data.users || []).map((u) => u.username), [data.users]);
  const idToUsername = useMemo(() => {
    const map = new Map();
    (data.users || []).forEach((u) => map.set(u.id, u.username));
    return map;
  }, [data.users]);
  const toUsername = (val) => {
    if (!val) return '';
    // if value is already a username, return it; otherwise try map by id
    if (usernames.includes(val)) return val;
    return idToUsername.get(val) || val;
  };
  const meId = (userData?.id || '').trim();
  const isRecipient = (r) => !!meId && (r?.to_user === meId || toUsername(r?.to_user || '') === (userData?.username || ''));

  const loadFinanceRequests = async () => {
    try {
      const list = await apiService.getRelatedFinanceRequests();
      setFinanceRequests(Array.isArray(list) ? list : []);
    } catch (_) {
      setFinanceRequests([]);
    }
  };

  useEffect(() => {
    loadFinanceRequests();
  }, [userData?.id]);

  useEffect(() => {
    const s = getSocket();
    const onChange = () => loadFinanceRequests();
    s.on('finance_requests:changed', onChange);
    return () => { s.off('finance_requests:changed', onChange); };
  }, []);

  // Персонализированный расчёт балансов: только операции текущего пользователя
  const balances = useMemo(() => {
    const me = (userData?.username || '').trim();
    const meId = (userData?.id || '').trim();
    const acc = {};
    (data.system?.currencies || []).forEach((c) => { acc[c] = 0; });
    if (!me) return acc;

    (data.transactions || []).forEach((t) => {
      const currency = t.currency;
      if (!currency || !(currency in acc)) return;
      // Игнорируем исходящие транзакции, требующие подтверждения, пока они не выполнены
      // Сервер помечает такие транзакции meta: { financeRequestId, status: 'В обработке' | 'Выполнено' | 'Отменена' }
      const meta = t.meta || {};
      const requiresApproval = t.type === 'outcome' && (meta.financeRequestId || meta.status);
      const status = (meta && meta.status) || null;
      if (requiresApproval && status !== 'Выполнено') return;
      const fromVal = t.from_user || '';
      const toVal = t.to_user || '';
      const fromU = (toUsername(fromVal) || '').toLowerCase();
      const toU = (toUsername(toVal) || '').toLowerCase();
      const meL = me.toLowerCase();

      // Если я получатель — плюс, если я отправитель — минус
      if ((toVal && meId && toVal === meId) || (toU && toU === meL)) {
        acc[currency] += Number(t.amount) || 0;
      } else if ((fromVal && meId && fromVal === meId) || (fromU && fromU === meL)) {
        acc[currency] -= Number(t.amount) || 0;
      }
    });

    return acc;
  }, [data.transactions, data.system?.currencies, userData?.username, idToUsername]);

  // Build user-specific transactions: only where current user is sender or recipient
  const myUsernameL = (userData?.username || '').trim().toLowerCase();
  const myId = (userData?.id || '').trim();
  const userTransactions = useMemo(() => {
    if (!Array.isArray(data.transactions)) return [];
    return data.transactions
      .map((t) => {
        const fromVal = t.from_user || '';
        const toVal = t.to_user || '';
        const fromU = (toUsername(fromVal) || '').toLowerCase();
        const toU = (toUsername(toVal) || '').toLowerCase();
        const involvesMe =
          (myId && (fromVal === myId || toVal === myId)) ||
          (myUsernameL && (fromU === myUsernameL || toU === myUsernameL));
        if (!involvesMe) return null;
        const _typeForMe = (myId && toVal === myId) || toU === myUsernameL ? 'income' : 'outcome';
        return { ...t, _typeForMe };
      })
      .filter(Boolean);
  }, [data.transactions, myUsernameL, myId, toUsername]);

  const transactionColumns = [
    {
      title: 'Дата (сервер)',
      key: 'date',
      width: 200,
      align: 'center',
      render: (_, record) => formatServerDate(record.createdAt || record.date),
      sorter: (a, b) => new Date(a.createdAt || a.date) - new Date(b.createdAt || b.date),
    },
    {
      title: 'Тип',
      dataIndex: '_typeForMe',
      key: 'type',
      width: 120,
      align: 'center',
      filters: [
        { text: 'Входящая', value: 'income' },
        { text: 'Исходящая', value: 'outcome' },
      ],
      onFilter: (value, record) => record._typeForMe === value,
      render: (_, record) => (
        <Tag color={record._typeForMe === 'income' ? 'green' : 'red'}>
          {record._typeForMe === 'income' ? 'Входящая' : 'Исходящая'}
        </Tag>
      ),
    },
    {
      title: 'Сумма',
      key: 'amount',
      width: 180,
      align: 'right',
      render: (_, record) => (
        <span className={record._typeForMe === 'income' ? 'currency-positive' : 'currency-negative'}>
          {record._typeForMe === 'income' ? '+' : '-'}
          {formatCurrency(record.amount, record.currency)} {record.currency}
        </span>
      ),
      sorter: (a, b) => a.amount - b.amount,
    },
    {
      title: 'Валюта',
      dataIndex: 'currency',
      key: 'currency',
      width: 100,
      align: 'center',
      filters: data.system.currencies.map((c) => ({ text: c, value: c })),
      onFilter: (value, record) => record.currency === value,
    },
    {
      title: 'Отправитель',
      key: 'from_user',
      dataIndex: 'from_user',
      width: 160,
      align: 'center',
      filters: usernames.map((u) => ({ text: u, value: u })),
      onFilter: (value, record) => toUsername(record.from_user || '') === value,
      render: (v) => toUsername(v) || '-',
    },
    {
      title: 'Получатель',
      key: 'to_user',
      dataIndex: 'to_user',
      width: 160,
      align: 'center',
      filters: usernames.map((u) => ({ text: u, value: u })),
      onFilter: (value, record) => toUsername(record.to_user || '') === value,
      render: (v) => toUsername(v) || '-',
    },
    {
      title: 'Назначение',
      dataIndex: 'desc',
      key: 'desc',
      minWidth: 200,
      ellipsis: true,
      render: (text, record) => {
        const val = text || record?.meta?.desc || '';
        return (
          <Tooltip title={val}>
            <span>{val}</span>
          </Tooltip>
        );
      },
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 180,
      align: 'center',
      render: (_, record) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <Tooltip title="Редактировать">
            <Button
              size="small"
              type="text"
              icon={<EditOutlined />}
              onClick={() => {
                setEditingTx(record);
                setTransactionModalVisible(true);
                const effectiveType = record._typeForMe || record.type;
                const cp = effectiveType === 'income' ? (record.from_user || null) : (record.to_user || null);
                transactionForm.setFieldsValue({
                  type: effectiveType,
                  amount: record.amount,
                  currency: record.currency,
                  // prefill counterparty by type; map ID to username if needed
                  counterparty: toUsername(cp) || null,
                  desc: record.desc || '',
                });
              }}
              disabled={!authService.hasPermission('finance', 'write')}
            />
          </Tooltip>
          <Tooltip title="Удалить">
            <Button
              size="small"
              type="text"
              icon={<DeleteOutlined />}
              danger
              onClick={() => {
                Modal.confirm({
                  title: 'Удалить транзакцию?',
                  content: 'Это действие нельзя отменить.',
                  okText: 'Удалить',
                  okType: 'danger',
                  cancelText: 'Отмена',
                  onOk: async () => {
                    try {
                      await apiService.deleteTransaction(record.id);
                      message.success('Транзакция удалена');
                      await queryClient.invalidateQueries({ queryKey: APP_DATA_QUERY_KEY });
                    } catch (e) {
                      message.error('Ошибка удаления транзакции');
                    }
                  },
                });
              }}
              disabled={!authService.hasPermission('finance', 'write')}
            />
          </Tooltip>
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <Button icon={<ReloadOutlined />} onClick={handleResetLayout} size="small">
          Сбросить раскладку
        </Button>
      </div>
      <ResponsiveGridLayout
        className="finance-grid"
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
        margin={[16, 16]}
        rowHeight={8}
        autoSize
        compactType="vertical"
        onLayoutChange={handleLayoutChange}
        draggableHandle=".card-draggable"
      >
        <div key="stats" style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {data.system.currencies.map((currency) => (
            <Card key={currency} size="small" style={{ minWidth: 220, flex: '1 1 220px' }} title={<span className="card-draggable" style={{ cursor: 'move' }}>Баланс ({currency})</span>}>
              <Statistic
                value={balances[currency]}
                precision={2}
                valueStyle={{ color: balances[currency] >= 0 ? '#52c41a' : '#f5222d' }}
                prefix={balances[currency] >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                suffix={currency}
              />
            </Card>
          ))}
        </div>

        <div key="transactions">
          <TableWithFullscreen
            title={<span className="card-draggable" style={{ cursor: 'move' }}>Транзакции</span>}
            extra={
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Input
                  allowClear
                  placeholder="Поиск по всем полям"
                  value={txSearch}
                  onChange={(e) => setTxSearch(e.target.value)}
                  style={{ width: 260 }}
                />
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setTransactionModalVisible(true)}
                  disabled={!authService.hasPermission('finance', 'write')}
                >
                  Добавить
                </Button>
              </div>
            }
            tableProps={{
              columns: transactionColumns,
              dataSource: userTransactions.filter((t) => {
                const q = String(txSearch || '').toLowerCase();
                if (!q) return true;
                const vals = [
                  t.id,
                  t._typeForMe,
                  t.type,
                  t.amount != null ? String(t.amount) : '',
                  t.currency,
                  toUsername(t.from_user || ''),
                  toUsername(t.to_user || ''),
                  t?.meta?.desc,
                  t.createdAt || t.date,
                ];
                return vals.some((v) => String(v || '').toLowerCase().includes(q));
              }),
              rowKey: "id",
              scroll: { x: 'max-content' },
              pagination: {
                pageSize: 20,
                showSizeChanger: true,
                showQuickJumper: true,
                showTotal: (total, range) => `${range[0]}-${range[1]} из ${total} транзакций`,
              },
              size: "middle",
              bordered: true,
              style: { width: '100%' },
              rowClassName: () => 'table-row',
            }}
            cardProps={{ style: { marginBottom: 0 }, bodyStyle: { paddingTop: 8 } }}
          >
          </TableWithFullscreen>
          {/* Внешние фильтры удалены: используйте фильтры в заголовках таблицы */}
        </div>

        <div key="currencies">
          <TableWithFullscreen
            title={<span className="card-draggable" style={{ cursor: 'move' }}>Валюты</span>}
            tableProps={{
              columns: currencyColumns,
              dataSource: data.system.currencies.map((c) => ({ currency: c })),
              rowKey: "currency",
              pagination: false,
              scroll: { y: 400 },
              size: "middle",
              bordered: true,
              style: { width: '100%' },
              rowClassName: () => 'table-row',
            }}
          />
        </div>
      </ResponsiveGridLayout>

      {/* Add Transaction Modal */}
      <Modal
        title="Добавить транзакцию"
        open={transactionModalVisible}
        onCancel={() => {
          setTransactionModalVisible(false);
          transactionForm.resetFields();
          setEditingTx(null);
        }}
        footer={null}
        width={500}
      >
        <Form form={transactionForm} layout="vertical" onFinish={addTransaction}>
          <Form.Item
            name="type"
            label="Тип операции"
            rules={[{ required: true, message: 'Выберите тип операции' }]}
          >
            <Select placeholder="Выберите тип">
              <Option value="income">Входящая</Option>
              <Option value="outcome">Исходящая</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="amount"
            label="Сумма"
            rules={[
              { required: true, message: 'Введите сумму' },
              { pattern: /^\d+(\.\d{1,2})?$/, message: 'Неверный формат суммы' },
            ]}
          >
            <Input type="number" step="0.01" min="0" placeholder="0.00" />
          </Form.Item>

          <Form.Item
            name="currency"
            label="Валюта"
            rules={[{ required: true, message: 'Выберите валюту' }]}
          >
            <Select placeholder="Выберите валюту">
              {data.system.currencies.map((currency) => (
                <Option key={currency} value={currency}>
                  {currency}
                </Option>
              ))}
            </Select>
          </Form.Item>

          {/* Counterparty by type: income -> sender, outcome -> recipient */}
          <Form.Item
            name="counterparty"
            label={txType === 'income' ? 'Отправитель (username)' : 'Получатель (username)'}
            tooltip={txType === 'income'
              ? (isAdmin
                ? 'Входящая: отправитель (username) — необязателен для администратора'
                : 'Входящая: укажите логин отправителя (у него будет списание, вам зачисление)')
              : 'Исходящая: укажите логин получателя (ему будет зачисление, у вас списание)'}
            rules={[{ required: txType === 'outcome' || (txType === 'income' && !isAdmin), message: txType === 'income' ? 'Укажите отправителя (username)' : 'Укажите получателя (username)' }]}
            extra={<Button size="small" onClick={() => transactionForm.setFieldsValue({ counterparty: null })}>Очистить</Button>}
          >
            <AutoComplete
              allowClear
              options={(data.users || []).map((u) => ({ value: u.username }))}
              placeholder={txType === 'income' ? 'Логин отправителя' : 'Логин получателя'}
              filterOption={(inputValue, option) =>
                String(option?.value || '').toLowerCase().includes(String(inputValue).toLowerCase())
              }
            />
          </Form.Item>

          <Form.Item
            name="desc"
            label="Назначение"
            rules={[{ required: true, message: 'Введите назначение' }]}
          >
            <TextArea rows={3} placeholder="Описание транзакции..." maxLength={500} showCount />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" style={{ marginRight: 8 }}>
              {editingTx ? 'Сохранить' : 'Добавить'}
            </Button>
            <Button onClick={() => setTransactionModalVisible(false)}>Отмена</Button>
          </Form.Item>
        </Form>
      </Modal>

      {/* Currency Management Modal would be implemented here... */}
    </div>
  );
};

export default Finance;
