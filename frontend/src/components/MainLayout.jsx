import React, { useState, useEffect } from 'react';
import { Layout, Menu, Button, Avatar, Dropdown, Space, Typography, Card, Tooltip, Tag, Skeleton } from 'antd';
import {
  UserOutlined,
  SettingOutlined,
  LogoutOutlined,
  DollarOutlined,
  FolderOutlined,
  TeamOutlined,
  ShopOutlined,
  AppstoreOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  BulbOutlined,
  MoonOutlined,
  SunOutlined,
} from '@ant-design/icons';
import Finance from './Finance/Finance';
import Directories from './Directories/Directories';
import Users from './Users/Users';
import Warehouse from './Warehouse/Warehouse';
import Showcase from './Showcase/Showcase';
import Settings from './Settings/Settings';
import Profile from './Profile/Profile';
import Cart from './Cart/Cart';
import Requests from './Requests/Requests';
import UEX from './UEX/UEX';
import { apiService } from '../services/apiService';
import { authService } from '../services/authService';
import { useQueryClient } from '@tanstack/react-query';
import { useAppDataQuery, APP_DATA_QUERY_KEY } from '../lib/queries/appData';
import { getSocket } from '../lib/realtime/socket';

const { Header, Sider, Content, Footer } = Layout;
const { Title } = Typography;

const MainLayout = ({ userData, onLogout, onUpdateUser, darkMode, onToggleTheme }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [selectedKey, setSelectedKey] = useState('finance');
  const queryClient = useQueryClient();
  const { data, isLoading } = useAppDataQuery();

  const refreshData = async () => {
    await queryClient.invalidateQueries({ queryKey: APP_DATA_QUERY_KEY });
  };

  // Realtime: subscribe to socket events and invalidate cached data
  useEffect(() => {
    const s = getSocket();
    const invalidate = () => queryClient.invalidateQueries({ queryKey: APP_DATA_QUERY_KEY });
    s.on('warehouse:changed', invalidate);
    s.on('transactions:changed', invalidate);
    s.on('users:changed', invalidate);
    s.on('directories:changed', invalidate);
    s.on('settings:changed', invalidate);
    s.on('showcase:changed', invalidate);
    s.on('requests:changed', invalidate);
    
    return () => {
      s.off('warehouse:changed', invalidate);
      s.off('transactions:changed', invalidate);
      s.off('users:changed', invalidate);
      s.off('directories:changed', invalidate);
      s.off('settings:changed', invalidate);
      s.off('showcase:changed', invalidate);
      s.off('requests:changed', invalidate);
      
    };
  }, [queryClient]);

  const onDataUpdate = async () => true;

  

  // Баланс по валютам для текущего пользователя (используется в шапке)
  const userBalances = React.useMemo(() => {
    const result = {};
    if (!data || !data.system) return result;
    const currencies = data.system.currencies || [];
    currencies.forEach((c) => (result[c] = 0));
    const meUsername = userData?.username;
    if (!meUsername || !Array.isArray(data.transactions)) return result;
    const me = (data.users || []).find((u) => u.username === meUsername);
    const meId = me?.id;
    for (const t of data.transactions) {
      const status = t?.meta?.status;
      const hasFinReq = !!t?.meta?.financeRequestId;
      if (hasFinReq && status !== 'Выполнено') continue; // до подтверждения не учитываем
      const cur = t?.currency;
      if (!cur) continue;
      if (!(cur in result)) result[cur] = 0;
      const toMatch = t?.to_user === meUsername || t?.to_user === meId;
      const fromMatch = t?.from_user === meUsername || t?.from_user === meId;
      // Всегда зачисляем получателю и списываем с отправителя, вне зависимости от поля type
      if (toMatch) result[cur] += Number(t.amount) || 0;
      if (fromMatch) result[cur] -= Number(t.amount) || 0;
    }
    return result;
  }, [data, userData?.username]);

  const rawMenuItems = [
    { key: 'finance', icon: <DollarOutlined />, label: 'Финансы', section: 'finance' },
    { key: 'warehouse', icon: <AppstoreOutlined />, label: 'Склад', section: 'warehouse' },
    { key: 'showcase', icon: <ShopOutlined />, label: 'Витрина', section: 'showcase' },
    // Заявки: показывается, если есть права на раздел requests (фильтруется ниже)
    { key: 'requests', icon: <AppstoreOutlined />, label: 'Заявки', section: 'requests' },
    { key: 'users', icon: <TeamOutlined />, label: 'Пользователи', section: 'users' },          
    { key: 'directories', icon: <FolderOutlined />, label: 'Справочники', section: 'directories' },  
    { key: 'uex', icon: <BulbOutlined />, label: 'UEX API', section: 'uex' },
    { key: 'settings', icon: <SettingOutlined />, label: 'Настройки', section: 'settings' },
  ];

  const canRead = (section) => {
    try {
      const atName = userData?.accountType;
      const ats = data?.directories?.accountTypes || [];
      const meType = ats.find((t) => t?.name === atName);
      const level = meType?.permissions?.[section];
      if (level) return level === 'read' || level === 'write';
    } catch (_) {}
    return authService.hasPermission(section, 'read');
  };

  const menuItems = rawMenuItems.filter((item) => canRead(item.section));

  // Если текущий выбранный раздел недоступен, переключимся на первый доступный
  useEffect(() => {
    // Try to restore last open section from localStorage
    try {
      const saved = localStorage.getItem('ui.lastSection');
      if (saved && rawMenuItems.find((i) => i.key === saved)) {
        setSelectedKey(saved);
      }
    } catch (_) {}

    if (menuItems.length > 0) {
      const current = rawMenuItems.find((i) => i.key === selectedKey);
      if (!current || !authService.hasPermission(current.section, 'read')) {
        setSelectedKey(menuItems[0].key);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData]);

  // Persist selection
  useEffect(() => {
    try { localStorage.setItem('ui.lastSection', selectedKey); } catch (_) {}
  }, [selectedKey]);

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: 'Профиль',
    },
    {
      key: 'cart',
      icon: <ShopOutlined />,
      label: 'Корзина',
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Выход',
    },
  ];

  const renderContent = () => {
    if (isLoading || !data) {
      // Skeleton layout: 3 stat cards + table placeholder
      return (
        <div className="fade-in">
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <Card size="small" style={{ minWidth: 220, flex: '1 1 220px' }}>
              <Skeleton active title={{ width: 120 }} paragraph={{ rows: 1 }} />
            </Card>
            <Card size="small" style={{ minWidth: 220, flex: '1 1 220px' }}>
              <Skeleton active title={{ width: 160 }} paragraph={{ rows: 1 }} />
            </Card>
            <Card size="small" style={{ minWidth: 260, flex: '1 1 260px' }}>
              <Skeleton active title={{ width: 180 }} paragraph={{ rows: 1 }} />
            </Card>
          </div>
          <Card size="small">
            <Skeleton active title paragraph={{ rows: 6 }} />
          </Card>
        </div>
      );
    }
    // Проверка прав на чтение раздела перед рендером
    const sec = rawMenuItems.find((i) => i.key === selectedKey)?.section;
    if (sec && !authService.hasPermission(sec, 'read')) {
      return (
        <div style={{ padding: 16 }}>
          <Card>
            <b>Нет доступа</b> к разделу
          </Card>
        </div>
      );
    }
    switch (selectedKey) {
      case 'finance':
        return (
          <Finance
            data={data}
            onDataUpdate={onDataUpdate}
            onRefresh={refreshData}
            userData={userData}
          />
        );
      case 'directories':
        return (
          <Directories
            data={data}
            onDataUpdate={onDataUpdate}
            onRefresh={refreshData}
            userData={userData}
            onUpdateUser={onUpdateUser}
          />
        );
      case 'users':
        return (
          <Users
            data={data}
            onDataUpdate={onDataUpdate}
            onRefresh={refreshData}
            userData={userData}
          />
        );
      case 'warehouse':
        return (
          <Warehouse
            data={data}
            onDataUpdate={onDataUpdate}
            onRefresh={refreshData}
            userData={userData}
          />
        );
      case 'showcase':
        return (
          <Showcase
            data={data}
            onRefresh={refreshData}
            userData={userData}
          />
        );
      case 'requests':
        return (
          <Requests />
        );
      case 'uex':
        return (
          <UEX />
        );
      case 'settings':
        return (
          <Settings
            data={data}
            onDataUpdate={onDataUpdate}
            onRefresh={refreshData}
            userData={userData}
          />
        );
      case 'profile':
        return (
          <Profile
            userData={userData}
            onUpdateUser={onUpdateUser}
            data={data}
            onDataUpdate={onDataUpdate}
          />
        );
      case 'cart':
        return <Cart />;
      default:
        return (
          <Finance
            data={data}
            onDataUpdate={onDataUpdate}
            userData={userData}
          />
        );
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider trigger={null} collapsible collapsed={collapsed} theme={darkMode ? 'dark' : 'light'} style={{ position: 'relative', height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            padding: collapsed ? '12px 8px' : '12px 16px',
            textAlign: 'center',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <Title level={4} style={{ margin: 0 }}>
            {collapsed ? 'BLSK SF' : 'BLSK Star Finance'}
          </Title>
          <div style={{ marginTop: 8 }}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
              shape={collapsed ? 'circle' : undefined}
              style={{ fontSize: '16px', width: collapsed ? 36 : 48, height: 36, margin: '0 auto', display: 'block' }}
            />
          </div>
        </div>
        <Menu
          theme={darkMode ? 'dark' : 'light'}
          mode="inline"
          inlineIndent={16}
          selectedKeys={[selectedKey]}
          onClick={({ key }) => setSelectedKey(key)}
          items={menuItems.map((mi) => ({
            ...mi,
            label: (
              <span style={{ fontWeight: mi.key === selectedKey ? 600 : 500, fontSize: 16 }}>
                {mi.label}
              </span>
            ),
          }))}
          style={{ borderRight: 0, flex: 1 }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            padding: '0 16px',
            background: 'transparent',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #f0f0f0',
            position: 'relative',
          }}
        >
          {/* Left side: per-currency balance for current user */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '4px 0' }}>
            {(data?.system?.currencies || []).map((c) => (
              <Tag key={`hdr-bal-${c}`} color={(userBalances[c] || 0) >= 0 ? 'green' : 'red'}>
                {Number(userBalances[c] || 0).toFixed(2)} {c}
              </Tag>
            ))}
          </div>
          <Space>
            <Tooltip title={darkMode ? 'Темная тема' : 'Светлая тема'}>
              <Button
                type="text"
                aria-label={darkMode ? 'Переключить на светлую тему' : 'Переключить на тёмную тему'}
                icon={darkMode ? <MoonOutlined /> : <SunOutlined />}
                onClick={() => onToggleTheme(!darkMode)}
                style={{
                  height: 'auto',
                  padding: '4px 8px',
                  color: darkMode ? '#60a5fa' : '#f59e0b', /* blue for dark, amber for light */
                }}
              />
            </Tooltip>
            <Dropdown
              menu={{
                items: userMenuItems,
                onClick: ({ key }) => {
                  if (key === 'logout') {
                    onLogout();
                    return;
                  }
                  if (key === 'profile') {
                    setSelectedKey('profile');
                  }
                  if (key === 'cart') {
                    setSelectedKey('cart');
                  }
                },
              }}
              placement="bottomRight"
            >
              <Button
                type="text"
                style={{ height: 'auto', padding: '4px 8px' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <Space>
                  <Avatar src={userData?.avatarUrl} icon={<UserOutlined />} />
                  <span>{userData?.username}</span>
                </Space>
              </Button>
            </Dropdown>
          </Space>
        </Header>
        <Content
          style={{
            margin: '16px',
            padding: '24px',
            background: 'transparent',
            borderRadius: '8px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          {renderContent()}
        </Content>
        <Footer style={{ textAlign: 'center', padding: '8px 16px', background: 'transparent' }}>
          Разработано Попов Е.Ф. (@StAim)
        </Footer>
      </Layout>
    </Layout>
  );
};

export default MainLayout;
