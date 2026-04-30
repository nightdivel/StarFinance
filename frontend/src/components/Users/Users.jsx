import React, { useEffect, useMemo, useState } from 'react';
import {
  Table,
  Card,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Tag,
  Space,
  message,
} from 'antd';
import { Tooltip } from 'antd';
import { Avatar } from 'antd';
import { Responsive, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  UserOutlined,
  MailOutlined,
  LockOutlined,
} from '@ant-design/icons';
import TableWithFullscreen from '../common/TableWithFullscreen';

// Services
import { apiService } from '../../services/apiService';
import { authService } from '../../services/authService';

// Config
import { USER_ROLES } from '../../config/appConfig';
import { compareDropdownStrings, getDisplayName } from '../../utils/helpers';

const { Option } = Select;

const ResponsiveGridLayout = WidthProvider(Responsive);

const Users = ({ data, onDataUpdate: _onDataUpdate, onRefresh, userData }) => {
  const [modalVisible, setModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form] = Form.useForm();
  const [pwdForm] = Form.useForm();
  const [pwdModalOpen, setPwdModalOpen] = useState(false);
  const [pwdTarget, setPwdTarget] = useState(null);
  const [userSearch, setUserSearch] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const [usersSearch, setUsersSearch] = useState('');

  // react-grid-layout persistence
  const layoutStorageKey = useMemo(() => {
    const user = userData?.username || 'anonymous';
    return `layout.users.${user}`;
  }, [userData?.username]);

  const defaultLayouts = {
    lg: [
      { i: 'stats', x: 0, y: 0, w: 12, h: 6, minW: 6, minH: 4 },
      { i: 'table', x: 0, y: 6, w: 12, h: 36, minW: 8, minH: 16 },
    ],
    md: [
      { i: 'stats', x: 0, y: 0, w: 10, h: 6, minW: 5, minH: 4 },
      { i: 'table', x: 0, y: 6, w: 10, h: 36, minW: 7, minH: 16 },
    ],
    sm: [
      { i: 'stats', x: 0, y: 0, w: 6, h: 6, minW: 4, minH: 4 },
      { i: 'table', x: 0, y: 6, w: 6, h: 36, minW: 4, minH: 16 },
    ],
    xs: [
      { i: 'stats', x: 0, y: 0, w: 4, h: 5, minW: 3, minH: 4 },
      { i: 'table', x: 0, y: 5, w: 4, h: 30, minW: 3, minH: 14 },
    ],
    xxs: [
      { i: 'stats', x: 0, y: 0, w: 2, h: 5, minW: 2, minH: 4 },
      { i: 'table', x: 0, y: 5, w: 2, h: 28, minW: 2, minH: 12 },
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
        const resp = await apiService.getUserLayouts('users');
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
    try { apiService.saveUserLayouts('users', allLayouts); } catch (_) {}
  };

  const handleResetLayout = () => {
    setLayouts(defaultLayouts);
    try { localStorage.removeItem(layoutStorageKey); } catch (_) {}
  };

  const currentUser = userData;

  // Check if user can be edited/deleted
  const canModifyUser = (user) => {
    if (user.id === currentUser?.id) return false;
    return authService.hasPermission('users', 'write');
  };

  // Update user (или создать нового, если isCreating)
  const updateUser = async (values) => {
    try {
      if (isCreating) {
        await apiService.saveUser({
          username: values.username,
          nickname: values.nickname || '',
          email: values.email || '',
          password: values.password,
          accountType: values.accountType,
          isActive: values.isActive ?? true,
        });
        message.success('Пользователь создан');
      } else if (editingUser) {
        await apiService.saveUser({
          id: editingUser.id,
          username: values.username,
          nickname: values.nickname || '',
          email: values.email || '',
          accountType: values.accountType,
          isActive: values.isActive ?? true,
        });
        message.success('Пользователь обновлен');
      }
      await onRefresh?.();
    } catch (error) {
      message.error(isCreating ? 'Ошибка создания пользователя' : 'Ошибка обновления пользователя');
    } finally {
      setModalVisible(false);
      setEditingUser(null);
      setIsCreating(false);
      form.resetFields();
    }
  };

  // Delete user
  const deleteUser = async (userId) => {
    Modal.confirm({
      title: 'Удалить пользователя?',
      content: 'Это действие нельзя отменить.',
      okText: 'Удалить',
      okType: 'danger',
      cancelText: 'Отмена',
      onOk: async () => {
        try {
          await apiService.deleteUser(userId);
          message.success('Пользователь удален');
          await onRefresh?.();
        } catch (error) {
          message.error('Ошибка удаления пользователя');
        }
      },
    });
  };

  // Edit user
  const editUser = (user) => {
    setEditingUser(user);
    form.setFieldsValue(user);
    setIsCreating(false);
    setModalVisible(true);
  };

  // Helper: compute balances for user
  const calcUserBalances = (username) => {
    const result = {};
    const currencies = data?.system?.currencies || [];
    currencies.forEach((c) => (result[c] = 0));
    if (!username || !Array.isArray(data?.transactions)) return result;
    const me = (data?.users || []).find((u) => u.username === username);
    const meId = me?.id;
    for (const t of data.transactions) {
      if (!t || !t.currency) continue;
      const cur = t.currency;
      if (!(cur in result)) result[cur] = 0;
      // Credit recipient regardless of type, debit sender regardless of type (match username or id)
      if (t.to_user === username || t.to_user === meId) result[cur] += Number(t.amount) || 0;
      if (t.from_user === username || t.from_user === meId) result[cur] -= Number(t.amount) || 0;
    }
    return result;
  };

  const manageColumns = [
    {
      title: '#',
      key: 'index',
      width: 50,
      align: 'center',
      fixed: 'left',
      render: (_, __, index) => index + 1,
    },
    {
      title: '',
      key: 'avatar',
      width: 48,
      render: (_, record) => (
        <Avatar size={32} src={record.avatarUrl} icon={<UserOutlined />} />
      ),
      fixed: 'left',
    },
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 120,
      render: (id) => <Tag>{id}</Tag>,
    },
    {
      title: 'Имя',
      dataIndex: 'username',
      key: 'username',
      width: 180,
      sorter: (a, b) => compareDropdownStrings(getDisplayName(a, data.users || []), getDisplayName(b, data.users || [])),
      ellipsis: true,
      render: (_, record) => (
        <Tooltip title={getDisplayName(record, data.users || [])}>
          <span>{getDisplayName(record, data.users || [])}</span>
        </Tooltip>
      ),
      filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
        <div className="p-2" onKeyDown={(e) => e.stopPropagation()}>
          <Input
            placeholder="Поиск по имени или логину"
            value={selectedKeys[0]}
            onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
            onPressEnter={() => confirm()}
            className="mb-2 block"
          />
          <Space>
            <Button type="primary" size="small" onClick={() => confirm()}>
              Найти
            </Button>
            <Button size="small" onClick={() => { clearFilters?.(); confirm(); }}>Сбросить</Button>
          </Space>
        </div>
      ),
      onFilter: (value, record) => {
        const display = getDisplayName(record, data.users || []).toLowerCase();
        return display.includes(String(value).toLowerCase());
      },
    },
    {
      title: 'Баланс',
      key: 'balance',
      width: 260,
      ellipsis: true,
      render: (_, record) => {
        const b = calcUserBalances(record.username);
        const entries = Object.entries(b).filter(([, v]) => v !== 0);
        if (entries.length === 0) return <span>-</span>;
        return (
          <Space size={[4, 4]} wrap>
            {entries.map(([cur, val]) => (
              <Tag key={`${record.username}-${cur}`} color={val >= 0 ? 'green' : 'red'}>
                {val.toFixed(2)} {cur}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      width: 200,
      ellipsis: true,
      render: (email) => (
        <Tooltip title={email || '-'}>
          <span>{email || '-'}</span>
        </Tooltip>
      ),
      filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
        <div className="p-2" onKeyDown={(e) => e.stopPropagation()}>
          <Input
            placeholder="Поиск по email"
            value={selectedKeys[0]}
            onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
            onPressEnter={() => confirm()}
            className="mb-2 block"
          />
          <Space>
            <Button type="primary" size="small" onClick={() => confirm()}>
              Найти
            </Button>
            <Button size="small" onClick={() => { clearFilters?.(); confirm(); }}>Сбросить</Button>
          </Space>
        </div>
      ),
      onFilter: (value, record) => (record.email || '').toLowerCase().includes(String(value).toLowerCase()),
    },
    {
      title: 'Тип учетной записи',
      dataIndex: 'accountType',
      key: 'accountType',
      width: 180,
      filters: Array.isArray(data?.directories?.accountTypes)
        ? data.directories.accountTypes.map((t) => ({ text: t.name, value: t.name }))
        : Object.values(USER_ROLES).map((role) => ({ text: role, value: role })),
      onFilter: (value, record) => record.accountType === value,
      render: (type) => <Tag>{type}</Tag>,
    },
    {
      title: 'Статус',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 100,
      filters: [
        { text: 'Активен', value: true },
        { text: 'Заблокирован', value: false },
      ],
      onFilter: (value, record) => record.isActive === value,
      render: (isActive) => (
        <Tag color={isActive ? 'green' : 'red'}>{isActive ? 'Активен' : 'Заблокирован'}</Tag>
      ),
    },
    {
      title: 'Способ авторизации',
      dataIndex: 'authType',
      key: 'authType',
      width: 120,
      render: (type) => (
        <Tag color={type === 'discord' ? 'purple' : 'orange'}>
          {type === 'discord' ? 'Discord' : 'Локальная'}
        </Tag>
      ),
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 170,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Tooltip title="Редактировать">
            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => editUser(record)} disabled={!canModifyUser(record)} />
          </Tooltip>
          {record.authType === 'local' && (
            <Tooltip title="Сменить пароль">
              <Button size="small" type="text" icon={<LockOutlined />} onClick={() => { setPwdTarget(record); setPwdModalOpen(true); }} disabled={!canModifyUser(record)} />
            </Tooltip>
          )}
          <Tooltip title="Удалить">
            <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => deleteUser(record.id)} disabled={!canModifyUser(record)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  // Summary table columns for workspace
  const summaryColumns = [
    {
      title: '#',
      key: 'index',
      width: 50,
      align: 'center',
      fixed: 'left',
      render: (_, __, index) => index + 1,
    },
    {
      title: 'Аватарка', key: 'avatar', width: 56, fixed: 'left',
      render: (_, r) => <Avatar size={32} src={r.avatarUrl} icon={<UserOutlined />} />,
    },
    { title: 'Имя', key: 'displayName', width: 200, ellipsis: true, render: (_, r) => getDisplayName(r, data.users || []) || '-' },
    {
      title: 'Баланс', key: 'balance', width: 260, ellipsis: true,
      render: (_, r) => {
        const b = calcUserBalances(r.username);
        const entries = Object.entries(b).filter(([, v]) => v !== 0);
        if (entries.length === 0) return <span>-</span>;
        return (
          <Space size={[4,4]} wrap>
            {entries.map(([cur, val]) => (
              <Tag key={`${r.username}-${cur}`} color={val >= 0 ? 'green' : 'red'}>
                {val.toFixed(2)} {cur}
              </Tag>
            ))}
          </Space>
        );
      }
    },
    {
      title: 'Управление пользователями', key: 'manage', width: 220,
      render: (_, record) => (
        <Button
          type="default"
          onClick={() => editUser(record)}
          disabled={!authService.hasPermission('users', 'write')}
        >
          Настроить
        </Button>
      )
    },
    {
      title: 'Статус', dataIndex: 'isActive', key: 'isActive', width: 120,
      render: (isActive) => <Tag color={isActive ? 'green' : 'red'}>{isActive ? 'Активен' : 'Заблокирован'}</Tag>
    },
    {
      title: 'Способ авторизации', dataIndex: 'authType', key: 'authType', width: 160,
      render: (type) => <Tag color={type === 'discord' ? 'purple' : 'orange'}>{type === 'discord' ? 'Discord' : 'Локальная'}</Tag>
    },
  ];

  // Simple stats
  const totalUsers = (data.users || []).length;
  const activeUsers = (data.users || []).filter((u) => u.isActive).length;
  const discordUsers = (data.users || []).filter((u) => u.authType === 'discord').length;

  return (
    <div className="p-1">
      <div className="d-flex justify-content-end mb-2">
        <Button type="primary" size="small" onClick={handleResetLayout}>Сбросить расположение</Button>
      </div>
      <ResponsiveGridLayout
        className="users-grid"
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
        margin={{ lg: [16, 16], md: [14, 14], sm: [10, 10], xs: [8, 8], xxs: [6, 6] }}
        rowHeight={8}
        autoSize
        compactType="vertical"
        onLayoutChange={handleLayoutChange}
        draggableHandle=".card-draggable"
      >
        <div key="stats" className="d-flex flex-wrap gap-3">
          <Card size="small" title={<span className="card-draggable cursor-move">Всего пользователей</span>} className="sf-minw-220">
            <div className="sf-text-20 fw-semibold">{totalUsers}</div>
          </Card>
          <Card size="small" title={<span className="card-draggable cursor-move">Активные</span>} className="sf-minw-220">
            <div className="sf-text-20 fw-semibold">{activeUsers}</div>
          </Card>
          <Card size="small" title={<span className="card-draggable cursor-move">Discord</span>} className="sf-minw-220">
            <div className="sf-text-20 fw-semibold">{discordUsers}</div>
          </Card>
        </div>

        <div key="table">
          <Card size="small" title={<span className="card-draggable cursor-move">Пользователи</span>} extra={
            <Space>
              <Input
                allowClear
                placeholder="Поиск по всем полям"
                value={usersSearch}
                onChange={(e) => setUsersSearch(e.target.value)}
                className="sf-w-260"
              />
              <Button type="primary" size="small" onClick={() => setManageOpen(true)} disabled={!authService.hasPermission('users', 'write')}>
                Управление пользователями
              </Button>
            </Space>
          }>
            <TableWithFullscreen
              tableProps={{
                columns: summaryColumns,
                dataSource: (data.users || [])
                  .map((u) => ({ ...u }))
                  .filter((u) => {
                    const q = String(usersSearch || '').toLowerCase();
                    if (!q) return true;
                    const vals = [
                      u.id,
                      u.username,
                      u.nickname,
                      u.email,
                      u.accountType,
                      typeof u.isActive === 'boolean' ? (u.isActive ? 'активен' : 'заблокирован') : '',
                      u.authType,
                    ];
                    return vals.some((v) => String(v || '').toLowerCase().includes(q));
                  }),
                rowKey: 'id',
                pagination: { pageSize: 20 },
                scroll: { x: '100%' },
              }}
            />
          </Card>
        </div>
      </ResponsiveGridLayout>

      {/* Edit User Modal */}
      <Modal
        title={isCreating ? 'Добавить пользователя' : 'Редактирование пользователя'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingUser(null);
          form.resetFields();
        }}
        footer={null}
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={updateUser}>
          <Form.Item
            name="username"
            label="Логин"
            rules={[{ required: true, message: 'Введите логин' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="Логин пользователя" disabled={!!editingUser && editingUser.authType === 'discord'} />
          </Form.Item>

          <Form.Item
            name="nickname"
            label="Псевдоним"
          >
            <Input placeholder="Отображаемое имя" />
          </Form.Item>

          <Form.Item
            name="email"
            label="Email"
            rules={[{ type: 'email', message: 'Неверный формат email' }]}
          >
            <Input prefix={<MailOutlined />} placeholder="email@example.com" />
          </Form.Item>

          {isCreating && (
            <>
              <Form.Item
                name="password"
                label="Пароль"
                rules={[
                  { required: true, message: 'Введите пароль' },
                  { min: 4, message: 'Минимум 4 символа' },
                ]}
              >
                <Input.Password prefix={<LockOutlined />} placeholder="Введите пароль" />
              </Form.Item>

              <Form.Item
                name="confirmPassword"
                label="Подтверждение пароля"
                dependencies={['password']}
                rules={[
                  { required: true, message: 'Подтвердите пароль' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('password') === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error('Пароли не совпадают'));
                    },
                  }),
                ]}
              >
                <Input.Password prefix={<LockOutlined />} placeholder="Повторите пароль" />
              </Form.Item>
            </>
          )}

          <Form.Item
            name="accountType"
            label="Тип учетной записи"
            rules={[{ required: true, message: 'Выберите тип учетной записи' }]}
          >
            <Select placeholder="Выберите тип">
              {Array.isArray(data?.directories?.accountTypes) &&
              data.directories.accountTypes.length > 0
                ? data.directories.accountTypes
                    .slice()
                    .sort((a, b) => compareDropdownStrings(a.name, b.name))
                    .map((t) => (
                      <Option key={t.name} value={t.name}>
                        {t.name}
                      </Option>
                    ))
                : [USER_ROLES.ADMIN, USER_ROLES.USER, USER_ROLES.GUEST]
                    .slice()
                    .sort((a, b) => compareDropdownStrings(a, b))
                    .map((role) => (
                      <Option key={role} value={role}>
                        {role}
                      </Option>
                    ))}
            </Select>
          </Form.Item>

          <Form.Item name="isActive" label="Статус" valuePropName="checked">
            <Switch checkedChildren="Активен" unCheckedChildren="Заблокирован" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" size="small" htmlType="submit" className="mr-2">
              Сохранить
            </Button>
            <Button onClick={() => setModalVisible(false)}>Отмена</Button>
          </Form.Item>
        </Form>
      </Modal>

      {/* Manage Users Modal with full management table */}
      <Modal
        title="Управление пользователями"
        open={manageOpen}
        onCancel={() => setManageOpen(false)}
        footer={null}
        width={1000}
      >
        <TableWithFullscreen
          tableProps={{
            columns: manageColumns,
            dataSource: (data.users || []).filter((u) => {
              const q = String(userSearch || '').toLowerCase();
              if (!q) return true;
              const vals = [u.id, u.username, u.email, u.accountType, typeof u.isActive === 'boolean' ? (u.isActive ? 'активен' : 'заблокирован') : '', u.authType, u.nickname];
              return vals.some((v) => String(v || '').toLowerCase().includes(q));
            }),
            rowKey: 'id',
            scroll: { x: '100%' },
            pagination: { pageSize: 20 },
          }}
          extra={
            <Space>
              <Input allowClear placeholder="Поиск по всем полям" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} className="sf-w-260" />
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => { setIsCreating(true); setEditingUser(null); form.resetFields(); form.setFieldsValue({ username: '', email: '', nickname: '', accountType: 'Пользователь', isActive: true, permissions: {}, }); setModalVisible(true); }} disabled={!authService.hasPermission('users', 'write')}>
                Добавить
              </Button>
            </Space>
          }
        />
      </Modal>

      {/* Change Password Modal */}
      <Modal
        title={pwdTarget ? `Смена пароля: ${pwdTarget.username}` : 'Смена пароля'}
        open={pwdModalOpen}
        onCancel={() => { setPwdModalOpen(false); setPwdTarget(null); pwdForm.resetFields(); }}
        footer={null}
        width={480}
      >
        <Form
          form={pwdForm}
          layout="vertical"
          onFinish={async (values) => {
            try {
              await apiService.changeUserPassword(pwdTarget.id, { newPassword: values.newPassword });
              message.success('Пароль изменён');
              setPwdModalOpen(false);
              setPwdTarget(null);
              pwdForm.resetFields();
            } catch (e) {
              message.error('Ошибка смены пароля');
            }
          }}
        >
          <Form.Item
            name="newPassword"
            label="Новый пароль"
            rules={[{ required: true, message: 'Введите новый пароль' }, { min: 4, message: 'Минимум 4 символа' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Введите новый пароль" />
          </Form.Item>
          <Form.Item
            name="confirm"
            label="Подтверждение пароля"
            dependencies={["newPassword"]}
            rules={[({ getFieldValue }) => ({ validator(_, v) { if (!v || v === getFieldValue('newPassword')) return Promise.resolve(); return Promise.reject(new Error('Пароли не совпадают')); }})]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Повторите пароль" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" size="small" htmlType="submit">Сохранить</Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Users;
