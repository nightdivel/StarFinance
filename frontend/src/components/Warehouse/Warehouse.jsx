import React, { useEffect, useMemo, useState } from 'react';
import {
  Table,
  Card,
  Button,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Tag,
  Space,
  message,
  Row,
  Col,
} from 'antd';
import { Tooltip } from 'antd';
import { Responsive, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
} from '@ant-design/icons';
import TableWithFullscreen from '../common/TableWithFullscreen';
import { useQueryClient } from '@tanstack/react-query';
import { APP_DATA_QUERY_KEY } from '../../lib/queries/appData';

// Services
import { apiService } from '../../services/apiService';
import { authService } from '../../services/authService';

// Config
import { SHOWCASE_STATUSES } from '../../config/appConfig';

const { Option } = Select;
const { TextArea } = Input;

const ResponsiveGridLayout = WidthProvider(Responsive);

const Warehouse = ({ data, onDataUpdate: _onDataUpdate, onRefresh, userData }) => {
  const queryClient = useQueryClient();
  const [modalVisible, setModalVisible] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [form] = Form.useForm();
  const productTypeSelected = Form.useWatch('productType', form);
  const [whSearch, setWhSearch] = useState('');

  // react-grid-layout: layouts
  const layoutStorageKey = useMemo(() => {
    const user = userData?.username || 'anonymous';
    return `layout.warehouse.${user}`;
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
        const resp = await apiService.getUserLayouts('warehouse');
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
    try { apiService.saveUserLayouts('warehouse', allLayouts); } catch (_) {}
  };

  const handleResetLayout = () => {
    setLayouts(defaultLayouts);
    try { localStorage.removeItem(layoutStorageKey); } catch (_) {}
  };

  // Format currency number (ru-RU) with 2 decimals
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value || 0);
  };

  // Add or update product
  const handleProductSubmit = async (values) => {
    try {
      // Map form values to backend schema
      const selectedCurrencies = Array.isArray(values.currencies) ? values.currencies.filter(Boolean) : [];
      const baseCurrency = selectedCurrencies[0] || values.currency || data.system.baseCurrency;
      const showcaseCurrencies = Array.isArray(values.showcaseDisplayCurrencies)
        ? values.showcaseDisplayCurrencies.filter(Boolean)
        : [];
      const payload = {
        id: editingProduct?.id,
        name: values.name,
        type: values.productType || null,
        quantity: values.quantity,
        price: parseFloat(values.cost),
        currency: baseCurrency,
        location: values.location || null,
        ownerLogin: values.ownerLogin || null,
        warehouseType: values.warehouseType || null,
        displayCurrencies:
          selectedCurrencies.length > 0
            ? selectedCurrencies
            : [baseCurrency],
        meta: (() => {
          const m = {};
          if (values.description) m.desc = values.description;
          if (showcaseCurrencies.length > 0) m.showcaseCurrencies = showcaseCurrencies;
          return Object.keys(m).length ? m : undefined;
        })(),
      };

      // Upsert warehouse item
      const resp = await apiService.saveWarehouseItem(payload);
      const saved = resp?.item || resp;

      // Handle showcase status
      if (values.showcaseStatus === 'На витрине') {
        await apiService.saveShowcaseItem({
          warehouseItemId: saved.id,
          status: 'На витрине',
          price: payload.price,
          currency: payload.currency,
        });
      } else {
        await apiService.deleteShowcaseByWarehouse(saved.id);
      }

      message.success(editingProduct ? 'Товар обновлен' : 'Товар добавлен');
      setModalVisible(false);
      setEditingProduct(null);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: APP_DATA_QUERY_KEY });
    } catch (error) {
      message.error('Ошибка сохранения товара');
    }
  };

  // Delete product
  const deleteProduct = async (productId) => {
    Modal.confirm({
      title: 'Удалить товар?',
      content: 'Это действие нельзя отменить.',
      okText: 'Удалить',
      okType: 'danger',
      cancelText: 'Отмена',
      onOk: async () => {
        try {
          await apiService.deleteWarehouseItem(productId);
          // Удалим с витрины, если был
          await apiService.deleteShowcaseByWarehouse(productId);
          message.success('Товар удален');
          await queryClient.invalidateQueries({ queryKey: APP_DATA_QUERY_KEY });
        } catch (error) {
          if (error && error.status === 404) {
            message.info('Товар не найден на сервере. Обновляю список...');
            await onRefresh?.();
            return;
          }
          message.error('Ошибка удаления товара');
        }
      },
    });
  };

  // Toggle showcase status
  const toggleShowcaseStatus = async (productId) => {
    try {
      const product = data.warehouse.find((p) => p.id === productId);
      if (!product) return;
      if (product.showcaseStatus === 'На витрине') {
        await apiService.deleteShowcaseByWarehouse(productId);
      } else {
        await apiService.saveShowcaseItem({
          warehouseItemId: productId,
          status: 'На витрине',
          price: product.cost || product.price,
          currency: product.currency,
        });
      }
      message.success('Статус витрины обновлен');
      await queryClient.invalidateQueries({ queryKey: APP_DATA_QUERY_KEY });
    } catch (error) {
      message.error('Ошибка обновления статуса');
    }
  };

  // Edit product
  const editProduct = (product) => {
    setEditingProduct(product);
    form.setFieldsValue({
      ...product,
      productType: product.productType,
      warehouseType: product.warehouseType,
      ownerLogin: product.ownerLogin || userData?.username,
      displayCurrencies: Array.isArray(product.displayCurrencies)
        ? product.displayCurrencies
        : product.displayCurrency
          ? [product.displayCurrency]
          : [product.currency],
      showcaseDisplayCurrencies: Array.isArray(product?.meta?.showcaseCurrencies)
        ? product.meta.showcaseCurrencies
        : [],
    });
    setModalVisible(true);
  };

  const canInlineEditQty = (record) => {
    if (authService.hasPermission('warehouse', 'write')) return true;
    // Разрешить, если владелец записи совпадает с текущим логином
    const myLogin = userData?.username;
    return record.ownerLogin && myLogin && record.ownerLogin === myLogin;
  };

  const onChangeQty = async (record, value) => {
    try {
      await apiService.changeWarehouseQuantity(record.id, value);
      message.success('Количество обновлено');
      await onRefresh?.();
    } catch (e) {
      message.error('Не удалось обновить количество');
    }
  };

  const isAdmin = () => {
    // Admins have users:write or explicit accountType; fallback to permission
    return authService.hasPermission('users', 'write');
  };
  const canModifyItem = (record) => {
    if (isAdmin()) return true;
    const myLogin = userData?.username;
    return record.ownerLogin && myLogin && record.ownerLogin === myLogin;
  };

  const columns = [
    {
      title: 'Название',
      dataIndex: 'name',
      key: 'name',
      width: 200,
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
      width: 160,
      filters: (data.directories.productTypes || []).map((t) => ({ text: t, value: t })),
      onFilter: (value, record) => record.productType === value,
      render: (v) => v || '-',
    },
    {
      title: 'Категория',
      dataIndex: 'category',
      key: 'category',
      width: 200,
      filters: (data.directories.categories || []).map((c) => ({
        text: c.name || c.id || '-',
        value: c.name || c.id || '-',
      })),
      onFilter: (value, record) => (record.category || '').toLowerCase() === String(value).toLowerCase(),
      render: (v) => v || '-',
    },
    {
      title: 'Склад',
      dataIndex: 'warehouseType',
      key: 'warehouseType',
      width: 160,
      filters: (data.directories.warehouseTypes || []).map((t) => ({ text: t, value: t })),
      onFilter: (value, record) => record.warehouseType === value,
      render: (v) => v || '-',
    },
    {
      title: 'Владелец',
      dataIndex: 'ownerLogin',
      key: 'ownerLogin',
      width: 160,
      render: (v) => v || '-',
      filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
        <div style={{ padding: 8 }} onKeyDown={(e) => e.stopPropagation()}>
          <Input
            placeholder="Поиск по владельцу"
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
      onFilter: (value, record) => (record.ownerLogin || '').toLowerCase().includes(String(value).toLowerCase()),
    },
    {
      title: 'Количество',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 100,
      render: (_, record) => (
        <InputNumber
          min={0}
          value={record.quantity || 0}
          onChange={(v) => onChangeQty(record, v)}
          disabled={!canInlineEditQty(record)}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'Стоимость',
      key: 'cost',
      width: 180,
      render: (_, record) => {
        const formatInt = (n) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.ceil(Number(n || 0)));
        const rates = data.system.rates || {};
        const from = record.currency;
        const displays = Array.isArray(record.displayCurrencies) && record.displayCurrencies.length > 0
          ? record.displayCurrencies
          : [record.displayCurrency || record.currency].filter(Boolean);
        const primary = displays[0] || record.currency;
        const toPrimaryRate = (rates[primary] || 1) / (rates[from] || 1);
        const primaryVal = Math.ceil((Number(record.cost) || 0) * toPrimaryRate);
        return (
          <div>
            <div style={{ fontWeight: 500 }}>{formatInt(primaryVal)} {primary}</div>
            {displays.slice(1).map((curr) => {
              const rate = (rates[curr] || 1) / (rates[from] || 1);
              const v = Math.ceil((Number(record.cost) || 0) * rate);
              return (
                <div key={`${record.id}-${curr}`} style={{ fontSize: 12, color: '#8c8c8c' }}>
                  {formatInt(v)} {curr}
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
      width: 240,
      ellipsis: true,
      render: (text, record) => {
        const val = text || record?.meta?.desc || '-';
        return (
          <Tooltip title={val}>
            <span>{val}</span>
          </Tooltip>
        );
      },
    },
    {
      title: 'Статус витрины',
      dataIndex: 'showcaseStatus',
      key: 'showcaseStatus',
      width: 120,
      filters: Object.values(SHOWCASE_STATUSES).map((status) => ({
        text: status,
        value: status,
      })),
      onFilter: (value, record) => record.showcaseStatus === value,
      render: (status) => <Tag color={status === 'На витрине' ? 'green' : 'red'}>{status}</Tag>,
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Tooltip title="Редактировать">
            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => editProduct(record)} disabled={!canModifyItem(record)} />
          </Tooltip>
          <Tooltip title="Удалить">
            <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => deleteProduct(record.id)} disabled={!canModifyItem(record)} />
          </Tooltip>
          <Tooltip title={record.showcaseStatus === 'На витрине' ? 'Скрыть с витрины' : 'Показать на витрине'}>
            <Button size="small" type="text" icon={record.showcaseStatus === 'На витрине' ? <EyeInvisibleOutlined /> : <EyeOutlined />} onClick={() => toggleShowcaseStatus(record.id)} disabled={!canModifyItem(record)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  // Простая статистика
  const totalItems = data.warehouse.length;
  const onShowcase = data.warehouse.filter((p) => p.showcaseStatus === 'На витрине').length;
  const totalQty = data.warehouse.reduce((sum, p) => sum + (Number(p.quantity) || 0), 0);
  // Общая стоимость позиций "На витрине" в базовой валюте
  const showcaseTotalValue = (() => {
    const base = data.system.baseCurrency;
    const rates = data.system.rates || {};
    const baseRate = rates[base] || 1;
    return data.warehouse
      .filter((p) => p.showcaseStatus === 'На витрине')
      .reduce((sum, p) => {
        const qty = Number(p.quantity) || 0;
        const cost = Number(p.cost != null ? p.cost : p.price) || 0;
        const from = p.currency;
        const rate = baseRate / (rates[from] || 1);
        return sum + cost * qty * rate;
      }, 0);
  })();

  return (
    <div style={{ padding: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <Button type="primary" onClick={handleResetLayout}>
          Сбросить расположение
        </Button>
      </div>
      <ResponsiveGridLayout
        className="warehouse-grid"
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
        <div key="stats" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Card size="small" title={<span className="card-draggable" style={{ cursor: 'move' }}>Всего на складе</span>} style={{ minWidth: 220 }}>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{totalItems}</div>
          </Card>
          <Card size="small" title={<span className="card-draggable" style={{ cursor: 'move' }}>На витрине</span>} style={{ minWidth: 220 }}>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{onShowcase}</div>
          </Card>
          <Card size="small" title={<span className="card-draggable" style={{ cursor: 'move' }}>Общая стоимость (на витрине)</span>} style={{ minWidth: 260 }}>
            <div style={{ fontSize: 20, fontWeight: 600 }}>
              {formatCurrency(showcaseTotalValue)} {data.system.baseCurrency}
            </div>
          </Card>
          <Card size="small" title={<span className="card-draggable" style={{ cursor: 'move' }}>Общее кол-во</span>} style={{ minWidth: 220 }}>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{totalQty}</div>
          </Card>
        </div>

        <div key="table">
          <TableWithFullscreen
            title={<span className="card-draggable" style={{ cursor: 'move' }}>Управление складом</span>}
            extra={
              <Space>
                <Input
                  allowClear
                  placeholder="Поиск по всем полям"
                  value={whSearch}
                  onChange={(e) => setWhSearch(e.target.value)}
                  style={{ width: 260 }}
                />
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setEditingProduct(null);
                    form.resetFields();
                    // Prefill owner for all users (admin can change later)
                    form.setFieldsValue({ ownerLogin: userData?.username });
                    setModalVisible(true);
                  }}
                  disabled={!authService.hasPermission('warehouse', 'write')}
                >
                  Добавить
                </Button>
              </Space>
            }
            tableProps={{
              columns,
              dataSource: (data.warehouse || []).filter((r) => {
                const q = String(whSearch || '').toLowerCase();
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
                ];
                return vals.some((v) => String(v || '').toLowerCase().includes(q));
              }).slice().sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0)),
              rowKey: 'id',
              scroll: { x: '100%' },
              pagination: false,
            }}
          />
        </div>
      </ResponsiveGridLayout>

      {/* Add/Edit Product Modal */}
      <Modal
        title={editingProduct ? 'Редактировать товар' : 'Добавить товар'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingProduct(null);
          form.resetFields();
        }}
        footer={null}
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={handleProductSubmit}>
          <Form.Item name="productType" label="Тип">
            <Select placeholder="Выберите тип">
              {(data.directories.productTypes || []).map((t) => (
                <Option key={t} value={t}>
                  {t}
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="warehouseType"
            label="Склад"
            rules={[{ required: true, message: 'Выберите склад' }]}
          >
            <Select placeholder="Выберите склад">
              {(data.directories.warehouseTypes || []).map((t) => (
                <Option key={t} value={t}>
                  {t}
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="name"
            label="Название"
            rules={[{ required: true, message: 'Введите название товара' }]}
          >
            {Array.isArray(data?.directories?.productNames) &&
            data.directories.productNames.length > 0 ? (
              <Select
                showSearch
                placeholder="Выберите товар"
                optionFilterProp="children"
                filterOption={(input, option) =>
                  (option?.children || '').toLowerCase().includes(input.toLowerCase())
                }
              >
                {data.directories.productNames
                  .map((item) =>
                    typeof item === 'string' ? { name: item, type: undefined } : item
                  )
                  .filter((obj) => {
                    if (!productTypeSelected) return true;
                    // Фильтрация по бизнес-типу или по UEX-категории
                    return (
                      obj.type === productTypeSelected ||
                      obj.uexCategory === productTypeSelected
                    );
                  })
                  .map((obj) => (
                    <Option key={`${obj.type || 'none'}-${obj.name}`} value={obj.name}>
                      {obj.uexCategory ? `${obj.uexCategory} • ${obj.name}` : obj.name}
                    </Option>
                  ))}
              </Select>
            ) : (
              <Input placeholder="Название товара или услуги" />
            )}
          </Form.Item>

          <Row gutter={16}>
            <Col xs={12}>
              <Form.Item
                name="quantity"
                label="Количество"
                rules={[{ required: true, message: 'Введите количество' }]}
              >
                <InputNumber min={0} placeholder="0" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12}>
              <Form.Item
                name="cost"
                label="Стоимость"
                rules={[{ required: true, message: 'Введите стоимость' }]}
              >
                <InputNumber min={0} step={0.01} placeholder="0.00" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          {/* Move description right after cost */}
          <Form.Item name="description" label="Описание">
            <TextArea
              rows={3}
              placeholder="Описание товара или услуги..."
              maxLength={500}
              showCount
            />
          </Form.Item>

          <Form.Item
            name="currencies"
            label="Валюты (основная — первая в списке)"
            tooltip="Выберите одну или несколько валют. Первая станет основной."
            rules={[{ validator: (_, v) => (Array.isArray(v) && v.length > 0 ? Promise.resolve() : Promise.reject(new Error('Выберите хотя бы одну валюту'))) }]}
          >
            <Select mode="multiple" placeholder="Выберите валюты">
              {data.system.currencies.map((currency) => (
                <Option key={currency} value={currency}>
                  {currency}
                </Option>
              ))}
            </Select>
          </Form.Item>

          {/* Owner field: editable only for admins */}
          <Form.Item name="ownerLogin" label="Владелец (логин)">
            {authService.hasPermission('users', 'write') ? (
              <Select showSearch allowClear placeholder="Выберите владельца">
                {(data.users || []).map((u) => (
                  <Option key={u.username} value={u.username}>{u.username}</Option>
                ))}
              </Select>
            ) : (
              <Input placeholder={userData?.username} value={userData?.username} readOnly />
            )}
          </Form.Item>

          <Form.Item
            name="showcaseDisplayCurrencies"
            label="Валюта отображения (витрина)"
            tooltip="Только для витрины. Можно выбрать несколько. Порядок определяет приоритет." >
            <Select mode="multiple" placeholder="Выберите валюты для витрины">
              {data.system.currencies.map((currency) => (
                <Option key={currency} value={currency}>
                  {currency}
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="showcaseStatus"
            label="Статус витрины"
            rules={[{ required: true, message: 'Выберите статус' }]}
          >
            <Select placeholder="Выберите статус">
              <Option value="На витрине">На витрине</Option>
              <Option value="Скрыт">Скрыт</Option>
            </Select>
          </Form.Item>

          {/* description moved above */}

          <Form.Item>
            <Button type="primary" htmlType="submit" style={{ marginRight: 8 }}>
              {editingProduct ? 'Сохранить' : 'Добавить'}
            </Button>
            <Button onClick={() => setModalVisible(false)}>Отмена</Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Warehouse;
