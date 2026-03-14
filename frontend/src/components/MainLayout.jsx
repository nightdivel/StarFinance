import React, { useState, useEffect } from 'react';
import { Layout, Menu, Button, Avatar, Dropdown, Space, Typography, Card, Tooltip, Tag, Skeleton, Drawer, Grid } from 'antd';
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
  MenuOutlined,
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
const { useBreakpoint } = Grid;

const MainLayout = ({ userData, onLogout, onUpdateUser, darkMode, onToggleTheme }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [selectedKey, setSelectedKey] = useState('finance');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const screens = useBreakpoint();
  const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isMobile = isMobileDevice || !screens.md;
  const queryClient = useQueryClient();
  const { data, isLoading } = useAppDataQuery(userData?.username);

  const refreshData = async () => {
    await queryClient.invalidateQueries({ queryKey: [...APP_DATA_QUERY_KEY, userData?.username || 'anonymous'] });
  };

  // Realtime: subscribe to socket events and invalidate cached data
  useEffect(() => {
    const s = getSocket();
    const invalidate = () =>
      queryClient.invalidateQueries({
        queryKey: [...APP_DATA_QUERY_KEY, userData?.username || 'anonymous'],
      });
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
  }, [queryClient, userData?.username]);

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

  const onSelectMenuKey = (key) => {
    setSelectedKey(key);
    if (isMobile) setMobileMenuOpen(false);
  };

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
          <div className="d-flex flex-wrap gap-3 mb-3">
            <Card size="small" className="sf-minw-220">
              <Skeleton active title={{ width: 120 }} paragraph={{ rows: 1 }} />
            </Card>
            <Card size="small" className="sf-minw-220">
              <Skeleton active title={{ width: 160 }} paragraph={{ rows: 1 }} />
            </Card>
            <Card size="small" className="sf-minw-260">
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
        <div className="p-2">
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
    <Layout className="min-vh-100 sf-app-shell">
      {!isMobile && (
        <Sider
          trigger={null}
          collapsible
          collapsed={collapsed}
          theme={darkMode ? 'dark' : 'light'}
          className="position-relative vh-100 d-flex flex-column sf-main-sider"
        >
          <div
            className={`${collapsed ? 'px-2 py-3' : 'px-4 py-4'} text-center border-bottom`}
          >
            <Title level={4} className="m-0">
              {collapsed ? 'BLSK SF' : 'BLSK Star Finance'}
            </Title>
            <div className="mt-2">
              <Button
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsed(!collapsed)}
                shape={collapsed ? 'circle' : undefined}
                className={`mx-auto d-block ${collapsed ? 'sf-w-36' : 'sf-w-48'}`}
              />
            </div>
          </div>
          <Menu
            theme={darkMode ? 'dark' : 'light'}
            mode="inline"
            inlineIndent={16}
            selectedKeys={[selectedKey]}
            onClick={({ key }) => onSelectMenuKey(key)}
            items={menuItems.map((mi) => ({
              ...mi,
              label: (
                <span className={`${mi.key === selectedKey ? 'fw-semibold' : 'fw-medium'}`}>
                  {mi.label}
                </span>
              ),
            }))}
            className="border-end-0 flex-grow-1 px-2 pt-2"
          />
        </Sider>
      )}
      <Layout>
        <Header
          className="px-4 bg-transparent d-flex justify-content-between align-items-center border-bottom position-relative sf-main-header"
        >
          {isMobile && (
            <Button
              type="text"
              aria-label="Открыть меню"
              icon={<MenuOutlined />}
              onClick={() => setMobileMenuOpen(true)}
              className="mr-2"
            />
          )}
          {/* Left side: per-currency balance for current user */}
          <div className="d-flex align-items-center gap-2 flex-wrap py-1 sf-header-balances">
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
                className={`h-auto px-2 py-1 ${darkMode ? 'text-primary' : 'text-warning'}`}
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
                className="h-auto py-1 px-2"
              >
                <Space>
                  <Avatar src={userData?.avatarUrl} icon={<UserOutlined />} />
                  <span>{userData?.username}</span>
                </Space>
              </Button>
            </Dropdown>
          </Space>
        </Header>
        <Drawer
          title="Меню"
          placement="left"
          open={isMobile && mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
          bodyStyle={{ padding: 0 }}
        >
          <Menu
            theme={darkMode ? 'dark' : 'light'}
            mode="inline"
            inlineIndent={16}
            selectedKeys={[selectedKey]}
            onClick={({ key }) => onSelectMenuKey(key)}
            items={menuItems.map((mi) => ({
              ...mi,
              label: <span>{mi.label}</span>,
            }))}
          />
        </Drawer>
        <Content className="p-2">
          {renderContent()}
        </Content>
        <Footer className="text-center py-3 px-4 bg-transparent text-muted">
          Разработано Попов Е.Ф. (@StAim)
        </Footer>
      </Layout>
    </Layout>
  );
};

export default MainLayout;
