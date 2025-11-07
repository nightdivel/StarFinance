import React, { useEffect, useMemo, useState } from 'react';
import { Table, Card, Input, Select, Tag, Row, Col, Statistic, Divider, Button, Space, Tooltip, InputNumber, message } from 'antd';
import TableWithFullscreen from '../common/TableWithFullscreen';
import { SearchOutlined, ShopOutlined } from '@ant-design/icons';
import { Responsive, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

// Config
import { CURRENCY_FORMAT } from '../../config/appConfig';
import { apiService } from '../../services/apiService';
import { useQueryClient } from '@tanstack/react-query';
import { APP_DATA_QUERY_KEY } from '../../lib/queries/appData';

const { Option } = Select;

const ResponsiveGridLayout = WidthProvider(Responsive);

const Showcase = ({ data, userData }) => {
  const queryClient = useQueryClient();
  const [qtyMap, setQtyMap] = useState({});
  const [scSearch, setScSearch] = useState('');

  // Only items on showcase
  const showcasedProducts = data.warehouse.filter((product) => product.showcaseStatus === 'На витрине');

  // Format currency as integer (ceil) with thousand separators
  const formatCurrency = (amount) => {
    const val = Math.ceil(Number(amount || 0));
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(val);
  };

  // Calculate statistics
  const statistics = {
    totalProducts: showcasedProducts.length,
    availableProducts: showcasedProducts.filter((p) => p.quantity > 0).length,
    totalValue: showcasedProducts.reduce(
      (sum, product) => sum + Math.ceil((Number(product.cost) || 0) * (Number(product.quantity) || 0)),
      0
    ),
  };

  const columns = [
    {
      title: 'Название',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      sorter: (a, b) => a.name.localeCompare(b.name),
      ellipsis: true,
      render: (text) => (
        <Tooltip title={text}>
          <span>{text}</span>
        </Tooltip>
      ),
      filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
        <div style={{ padding: 8 }} onKeyDown={(e) => e.stopPropagation()}>
          <Input
            placeholder="Поиск по названию"
            value={selectedKeys[0]}
            onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
            onPressEnter={() => confirm()}
            style={{ marginBottom: 8, display: 'block' }}
          />
          <Space>
            <Button type="primary" size="small" onClick={() => confirm()}>
              Найти
            </Button>
            <Button
              size="small"
              onClick={() => {
                clearFilters?.();
                confirm();
              }}
            >
              Сбросить
            </Button>
          </Space>
        </div>
      ),
      onFilter: (value, record) => (record.name || '').toLowerCase().includes(String(value).toLowerCase()),
    },
    {
      title: 'Тип',
      dataIndex: 'productType',
      key: 'productType',
      width: 120,
      filters: (data.directories.productTypes || []).map((t) => ({ text: t, value: t })),
      onFilter: (value, record) => record.productType === value,
      render: (type) => <Tag>{type || '-'}</Tag>,
    },
    {
      title: 'Склад',
      dataIndex: 'warehouseType',
      key: 'warehouseType',
      width: 140,
      filters: (data.directories.warehouseTypes || []).map((t) => ({ text: t, value: t })),
      onFilter: (value, record) => record.warehouseType === value,
      render: (v) => <Tag>{v || '-'}</Tag>,
    },
    {
      title: 'Владелец',
      dataIndex: 'ownerLogin',
      key: 'ownerLogin',
      width: 140,
      render: (v) => v || '-',
    },
    {
      title: 'Количество',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 100,
      sorter: (a, b) => a.quantity - b.quantity,
      render: (quantity) => (
        <span style={{ fontWeight: quantity > 0 ? 600 : 400 }}>
          {quantity > 0 ? quantity : 'Нет в наличии'}
        </span>
      ),
    },
    {
      title: 'Стоимость',
      key: 'price',
      width: 180,
      render: (_, record) => {
        const rates = data.system.rates || {};
        const displays =
          Array.isArray(record?.meta?.showcaseCurrencies) && record.meta.showcaseCurrencies.length > 0
            ? record.meta.showcaseCurrencies
            : [record.currency];

        const from = record.currency;
        const primary = displays[0];
        const primaryRate = (rates[primary] || 1) / (rates[from] || 1);
        const primaryValue = Math.ceil((Number(record.cost) || 0) * primaryRate);

        return (
          <div>
            <div style={{ fontWeight: 500 }}>
              {formatCurrency(primaryValue)} {primary}
            </div>
            {displays.slice(1).map((curr) => {
              const rate = (rates[curr] || 1) / (rates[from] || 1);
              const v = Math.ceil((Number(record.cost) || 0) * rate);
              return (
                <div key={curr} style={{ fontSize: 12, color: '#8c8c8c' }}>
                  {formatCurrency(v)} {curr}
                </div>
              );
            })}
          </div>
        );
      },
    },
    {
      title: 'Описание',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (description, record) => {
        const val = description || record?.meta?.desc || '-';
        return (
          <Tooltip title={val}>
            <span>{val}</span>
          </Tooltip>
        );
      },
    },
    {
      title: 'Купить',
      key: 'buy',
      width: 240,
      fixed: 'right',
      render: (_, record) => {
        const maxQty = Number(record.quantity) || 0;
        const isOwn = (record.ownerLogin || '') === (userData?.username || '');
        return (
          <Space>
            <InputNumber
              min={1}
              max={maxQty}
              value={qtyMap[record.id] || 1}
              onChange={(v) => setQtyMap((m) => ({ ...m, [record.id]: v }))}
              disabled={maxQty === 0 || isOwn}
              style={{ width: 96 }}
            />
            <Button
              type="primary"
              disabled={maxQty === 0 || isOwn}
              onClick={async () => {
                const q = Number(qtyMap[record.id] || 1);
                if (!(q > 0)) { message.warning('Укажите количество'); return; }
                if (q > maxQty) { message.error('Количество превышает доступное'); return; }
                try {
                  await apiService.createRequest({ warehouseItemId: record.id, quantity: q });
                  message.success('Заявка отправлена');
                  setQtyMap((m) => ({ ...m, [record.id]: 1 }));
                  await queryClient.invalidateQueries({ queryKey: APP_DATA_QUERY_KEY });
                } catch (e) {
                  const msg = e?.body || 'Ошибка покупки';
                  message.error(typeof msg === 'string' ? msg : 'Ошибка покупки');
                }
              }}
            >
              Купить
            </Button>
          </Space>
        );
      },
    },
  ];

  // react-grid-layout: layout persistence
  const layoutStorageKey = useMemo(() => {
    const user = userData?.username || 'anonymous';
    return `layout.showcase.${user}`;
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
      { i: 'stats', x: 0, y: 0, w: 4, h: 6, minW: 3, minH: 4 },
      { i: 'table', x: 0, y: 6, w: 4, h: 36, minW: 3, minH: 16 },
    ],
    xxs: [
      { i: 'stats', x: 0, y: 0, w: 2, h: 6, minW: 2, minH: 4 },
      { i: 'table', x: 0, y: 6, w: 2, h: 36, minW: 2, minH: 16 },
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
        const resp = await apiService.getUserLayouts('showcase');
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
    try { apiService.saveUserLayouts('showcase', allLayouts); } catch (_) {}
  };

  const handleResetLayout = () => {
    setLayouts(defaultLayouts);
    try { localStorage.removeItem(layoutStorageKey); } catch (_) {}
  };

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <Button onClick={handleResetLayout}>Сбросить раскладку</Button>
      </div>
      <ResponsiveGridLayout
        className="showcase-grid"
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
        <div key="stats">
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={8}>
              <Card size="small" title={<span className="card-draggable" style={{ cursor: 'move' }}>Всего товаров</span>}>
                <Statistic value={statistics.totalProducts} prefix={<ShopOutlined />} />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small" title={<span className="card-draggable" style={{ cursor: 'move' }}>Доступно</span>}>
                <Statistic value={statistics.availableProducts} />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small" title={<span className="card-draggable" style={{ cursor: 'move' }}>Общая стоимость</span>}>
                <Statistic value={statistics.totalValue} precision={2} suffix={data.system.baseCurrency} />
              </Card>
            </Col>
          </Row>
        </div>

        <div key="table">
          <TableWithFullscreen
            title={<span className="card-draggable" style={{ cursor: 'move' }}>Витрина товаров</span>}
            extra={
              <Space>
                <Input
                  allowClear
                  placeholder="Поиск по всем полям"
                  value={scSearch}
                  onChange={(e) => setScSearch(e.target.value)}
                  style={{ width: 260 }}
                />
              </Space>
            }
            tableProps={{
              columns,
              dataSource: showcasedProducts.filter((r) => {
                const q = String(scSearch || '').toLowerCase();
                if (!q) return true;
                const vals = [
                  r.name,
                  r.productType,
                  r.warehouseType,
                  r.ownerLogin,
                  r.quantity != null ? String(r.quantity) : '',
                  r.cost != null ? String(r.cost) : '',
                  r.currency,
                  r.showcaseStatus,
                  r.description,
                  r?.meta?.desc,
                ];
                return vals.some((v) => String(v || '').toLowerCase().includes(q));
              }),
              rowKey: 'id',
              scroll: { x: 'max-content' },
              pagination: false,
            }}
          />
        </div>
      </ResponsiveGridLayout>
    </div>
  );
};

export default Showcase;
