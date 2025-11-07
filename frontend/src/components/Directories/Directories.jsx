import React, { useEffect, useState } from 'react';
import {
  Table,
  Card,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Space,
  message,
  List,
  Row,
  Col,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';

// Services
import { apiService } from '../../services/apiService';
import { authService } from '../../services/authService';
import { PERMISSIONS } from '../../config/appConfig';
import TableWithFullscreen from '../common/TableWithFullscreen';

const { Option } = Select;
const { TextArea } = Input;

const Directories = ({ data, userData, onUpdateUser, onRefresh }) => {
  const [editingItem, setEditingItem] = useState(null);
  const [currentDirectory, setCurrentDirectory] = useState(null);
  const [form] = Form.useForm();
  const [scopes, setScopes] = useState([]);
  const [dirSearch, setDirSearch] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const resp = await apiService.getDiscordScopes();
        if (Array.isArray(resp)) setScopes(resp);
      } catch (_) {}
    })();
  }, []);

  // Get readable directory name
  function getDirectoryName(key) {
    const names = {
      productTypes: 'Типы товаров',
      showcaseStatuses: 'Статусы витрины',
      productNames: 'Товар',
      accountTypes: 'Типы учетной записи',
      warehouseLocations: 'Локации склада',
      warehouseTypes: 'Тип склада',
      discordScopes: 'Scopes (Discord)'
    };
    return names[key] || key;
  }

  // Get directory data for table
  const directoryData = [
    ...Object.entries(data.directories || {}).map(([key, items]) => ({
      key,
      name: getDirectoryName(key),
      itemCount: items.length,
      items,
    })),
    { key: 'discordScopes', name: getDirectoryName('discordScopes'), itemCount: scopes.length, items: scopes },
  ];

  // Add item to directory (все справочники через API)
  const addDirectoryItem = async (directoryKey, newItem) => {
    try {
      if (directoryKey === 'productTypes') {
        await apiService.addProductType(newItem);
        message.success('Тип товара добавлен');
        await onRefresh?.();
        setEditingItem(null);
        form.resetFields();
        return;
      }
      if (directoryKey === 'showcaseStatuses') {
        await apiService.addShowcaseStatus(newItem);
        message.success('Статус витрины добавлен');
        await onRefresh?.();
        setEditingItem(null);
        form.resetFields();
        return;
      }
      if (directoryKey === 'warehouseLocations') {
        await apiService.addWarehouseLocation(newItem);
        message.success('Локация склада добавлена');
        await onRefresh?.();
        setEditingItem(null);
        form.resetFields();
        return;
      }

      if (directoryKey === 'warehouseTypes') {
        await apiService.addWarehouseType(newItem);
        message.success('Тип склада добавлен');
        await onRefresh?.();
        setEditingItem(null);
        form.resetFields();
        return;
      }

      if (directoryKey === 'accountTypes' && newItem && typeof newItem === 'object') {
        await apiService.addAccountType({
          name: newItem.name,
          permissions: newItem.permissions || {},
          allowedWarehouseTypes: Array.isArray(newItem.allowedWarehouseTypes) ? newItem.allowedWarehouseTypes : [],
        });
        message.success('Тип учетной записи добавлен');
        await onRefresh?.();
        setEditingItem(null);
        form.resetFields();
        // Обновим права текущего пользователя, если его тип совпал
        if (userData && onUpdateUser && userData.accountType === newItem.name) {
          onUpdateUser({ ...userData, permissions: newItem.permissions || {} });
        }
        return;
      }

      if (directoryKey === 'productNames' && newItem && typeof newItem === 'object') {
        await apiService.addProductName({ name: newItem.name, type: newItem.type });
        message.success('Наименование добавлено');
        await onRefresh?.();
        setEditingItem(null);
        form.resetFields();
        return;
      }
      if (directoryKey === 'discordScopes') {
        await apiService.addDiscordScope(String(newItem));
        message.success('Scope добавлен');
        const resp = await apiService.getDiscordScopes();
        setScopes(Array.isArray(resp) ? resp : []);
        setEditingItem(null);
        form.resetFields();
        return;
      }
    } catch (error) {
      message.error('Ошибка добавления элемента');
    }
  };

  // Remove item from directory (все справочники через API)
  const removeDirectoryItem = async (directoryKey, itemIndex) => {
    Modal.confirm({
      title: 'Удалить элемент?',
      content: 'Это действие нельзя отменить.',
      okText: 'Удалить',
      okType: 'danger',
      cancelText: 'Отмена',
      onOk: async () => {
        try {
          const current = data.directories[directoryKey][itemIndex];
          if (directoryKey === 'productTypes') {
            await apiService.deleteProductType(current);
            message.success('Тип товара удален');
            await onRefresh?.();
            return;
          }
          if (directoryKey === 'showcaseStatuses') {
            await apiService.deleteShowcaseStatus(current);
            message.success('Статус витрины удален');
            await onRefresh?.();
            return;
          }
          if (directoryKey === 'warehouseLocations') {
            await apiService.deleteWarehouseLocation(current);
            message.success('Локация склада удалена');
            await onRefresh?.();
            return;
          }

          if (directoryKey === 'warehouseTypes') {
            await apiService.deleteWarehouseType(current);
            message.success('Тип склада удалён');
            await onRefresh?.();
            return;
          }

          if (directoryKey === 'accountTypes') {
            const currentObj = data.directories.accountTypes[itemIndex];
            const currentName = currentObj?.name || current;
            await apiService.deleteAccountType(currentName);
            message.success('Тип учетной записи удален');
            await onRefresh?.();
            return;
          }

          if (directoryKey === 'productNames') {
            const currentObj = data.directories.productNames[itemIndex];
            const currentName = typeof currentObj === 'string' ? currentObj : currentObj?.name;
            await apiService.deleteProductName(currentName);
            message.success('Наименование удалено');
            await onRefresh?.();
            return;
          }
          if (directoryKey === 'discordScopes') {
            const currentVal = scopes[itemIndex];
            await apiService.deleteDiscordScope(String(currentVal));
            message.success('Scope удалён');
            const resp = await apiService.getDiscordScopes();
            setScopes(Array.isArray(resp) ? resp : []);
            return;
          }
        } catch (error) {
          message.error('Ошибка удаления элемента');
        }
      },
    });
  };

  // Edit directory item (все справочники через API)
  const editDirectoryItem = async (directoryKey, itemIndex, newValue) => {
    try {
      if (['productTypes', 'showcaseStatuses', 'warehouseLocations', 'warehouseTypes'].includes(directoryKey)) {
        const current = data.directories[directoryKey][itemIndex];
        if (directoryKey === 'productTypes') {
          await apiService.deleteProductType(current);
          await apiService.addProductType(newValue);
        } else if (directoryKey === 'showcaseStatuses') {
          await apiService.deleteShowcaseStatus(current);
          await apiService.addShowcaseStatus(newValue);
        } else if (directoryKey === 'warehouseLocations') {
          await apiService.deleteWarehouseLocation(current);
          await apiService.addWarehouseLocation(newValue);
        } else if (directoryKey === 'warehouseTypes') {
          await apiService.deleteWarehouseType(current);
          await apiService.addWarehouseType(newValue);
        }
        message.success('Элемент обновлен');
        setEditingItem(null);
        await onRefresh?.();
        return;
      }

      if (directoryKey === 'productNames') {
        const current = data.directories.productNames[itemIndex];
        const currentName = typeof current === 'string' ? current : current?.name;
        await apiService.updateProductName(currentName, {
          name: newValue.name,
          type: newValue.type,
        });
        message.success('Наименование обновлено');
        setEditingItem(null);
        await onRefresh?.();
        return;
      }
      // accountTypes через API
      if (directoryKey === 'accountTypes') {
        const currentObj = data.directories.accountTypes[itemIndex];
        const currentName = currentObj?.name;
        await apiService.updateAccountType(currentName, {
          name: newValue?.name || currentName,
          permissions: newValue?.permissions || {},
          allowedWarehouseTypes: Array.isArray(newValue?.allowedWarehouseTypes) ? newValue.allowedWarehouseTypes : [],
        });
        message.success('Тип учетной записи обновлен');
        setEditingItem(null);
        await onRefresh?.();
        if (userData && onUpdateUser && userData.accountType === (newValue?.name || currentName)) {
          onUpdateUser({ ...userData, permissions: newValue?.permissions || {} });
        }
        return;
      }
    } catch (error) {
      message.error('Ошибка обновления элемента');
    }
  };

  const columns = [
    {
      title: 'Наименование',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      render: (name, record) => (
        <div>
          <div style={{ fontWeight: 600 }}>{name}</div>
          <div style={{ fontSize: 12, color: '#8c8c8c' }}>{record.key}</div>
        </div>
      ),
    },
    {
      title: 'Количество элементов',
      dataIndex: 'itemCount',
      key: 'itemCount',
      width: 120,
      render: (count) => <Tag color="blue">{count}</Tag>,
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 100,
      render: (_, record) => (
        <Button size="small" onClick={() => setCurrentDirectory(record)}>
          Просмотреть
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 4 }}>
      <Card title="Системные справочники">
        <Table
          columns={columns}
          dataSource={directoryData}
          rowKey="key"
          pagination={false}
          scroll={{ x: 600 }}
        />
      </Card>

      {/* Directory Items Modal */}
      <Modal
        title={currentDirectory ? `Справочник: ${currentDirectory.name}` : 'Справочник'}
        open={!!currentDirectory}
        onCancel={() => { setCurrentDirectory(null); setEditingItem(null); try { form.resetFields(); } catch (_) {} }}
        width={900}
        bodyStyle={{ maxHeight: '70vh', overflowY: 'auto' }}
        style={{ top: 24 }}
        footer={null}
      >
        {currentDirectory && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setEditingItem({ directory: currentDirectory.key, value: '' });
                  form.setFieldsValue({ newItem: '' });
                }}
                disabled={!authService.hasPermission('directories', 'write')}
              >
                Добавить
              </Button>
            </div>

            {
              // Построим таблицу для выбранного справочника
              (() => {
                const key = currentDirectory.key;
                let columns = [];
                let dataSource = [];
                const canWrite = authService.hasPermission('directories', 'write') || (key === 'discordScopes' && authService.hasPermission('settings', 'write'));

                const buildFilterDropdown = (placeholder) => ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
                  <div style={{ padding: 8 }} onKeyDown={(e) => e.stopPropagation()}>
                    <Input
                      placeholder={placeholder}
                      value={selectedKeys[0]}
                      onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
                      onPressEnter={() => confirm()}
                      style={{ marginBottom: 8, display: 'block' }}
                    />
                    <Space>
                      <Button type="primary" size="small" onClick={() => confirm()}>
                        Найти
                      </Button>
                      <Button size="small" onClick={() => { clearFilters?.(); confirm(); }}>Сбросить</Button>
                    </Space>
                  </div>
                );

                if (key === 'accountTypes') {
                  columns = [
                    {
                      title: 'Название типа', dataIndex: 'name', key: 'name', width: 220,
                      filterDropdown: buildFilterDropdown('Поиск по названию'),
                      onFilter: (v, r) => (r.name || '').toLowerCase().includes(String(v).toLowerCase()),
                    },
                    {
                      title: 'Права', dataIndex: 'permStr', key: 'permStr', ellipsis: true,
                    },
                    {
                      title: 'Склады', dataIndex: 'warehousesStr', key: 'warehousesStr', width: 260,
                    },
                    {
                      title: 'Действия', key: 'actions', width: 120, fixed: 'right',
                      render: (_, record, index) => (
                        <Space>
                          <Button size="small" type="text" icon={<EditOutlined />} disabled={!canWrite}
                            onClick={() => {
                              setEditingItem({ directory: key, index, value: record.raw });
                              form.setFieldsValue({ typeName: record.name, permissions: record.raw.permissions || {}, allowedWarehouseTypes: record.raw.allowedWarehouseTypes || [] });
                            }}
                          />
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={!canWrite}
                            onClick={() => removeDirectoryItem(key, index)}
                          />
                        </Space>
                      ),
                    },
                  ];
                  dataSource = (data.directories.accountTypes || []).map((it, idx) => ({
                    key: idx,
                    name: it.name,
                    permStr: Object.entries(it.permissions || {}).map(([res, perm]) => `${res}: ${perm}`).join(', ') || '—',
                    warehousesStr: Array.isArray(it.allowedWarehouseTypes) && it.allowedWarehouseTypes.length ? it.allowedWarehouseTypes.join(', ') : '—',
                    raw: it,
                  }));
                } else if (key === 'productNames') {
                  columns = [
                    {
                      title: 'Название', dataIndex: 'name', key: 'name', width: 220,
                      filterDropdown: buildFilterDropdown('Поиск по названию'),
                      onFilter: (v, r) => (r.name || '').toLowerCase().includes(String(v).toLowerCase()),
                    },
                    {
                      title: 'Тип', dataIndex: 'type', key: 'type', width: 180,
                      filters: (data.directories.productTypes || []).map((t) => ({ text: t, value: t })),
                      onFilter: (val, r) => r.type === val,
                    },
                    {
                      title: 'Действия', key: 'actions', width: 120, fixed: 'right',
                      render: (_, record, index) => (
                        <Space>
                          <Button size="small" type="text" icon={<EditOutlined />} disabled={!canWrite}
                            onClick={() => {
                              setEditingItem({ directory: key, index, value: record.raw });
                              form.setFieldsValue({ productName: record.name, productType: record.type });
                            }}
                          />
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={!canWrite}
                            onClick={() => removeDirectoryItem(key, index)}
                          />
                        </Space>
                      ),
                    },
                  ];
                  dataSource = (data.directories.productNames || []).map((it, idx) => {
                    const obj = typeof it === 'string' ? { name: it, type: undefined } : it;
                    return { key: idx, name: obj.name, type: obj.type, raw: obj };
                  });
                } else if (key === 'discordScopes') {
                  columns = [
                    {
                      title: 'Scope', dataIndex: 'value', key: 'value', width: 320,
                      filterDropdown: buildFilterDropdown('Поиск по scope'),
                      onFilter: (v, r) => (r.value || '').toLowerCase().includes(String(v).toLowerCase()),
                    },
                    {
                      title: 'Действия', key: 'actions', width: 120, align: 'center',
                      render: (_, __, index) => (
                        <Space>
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={!canWrite}
                            onClick={() => removeDirectoryItem(key, index)}
                          />
                        </Space>
                      ),
                    },
                  ];
                  dataSource = scopes.map((s, idx) => ({ key: idx, value: s }));
                } else {
                  // Простые справочники как таблица из одной колонки
                  columns = [
                    {
                      title: 'Значение', dataIndex: 'value', key: 'value', width: 320,
                      filterDropdown: buildFilterDropdown('Поиск по значению'),
                      onFilter: (v, r) => (r.value || '').toLowerCase().includes(String(v).toLowerCase()),
                    },
                    {
                      title: 'Действия', key: 'actions', width: 120, align: 'center',
                      render: (_, record, index) => (
                        <Space>
                          <Button size="small" type="text" icon={<EditOutlined />} disabled={!canWrite}
                            onClick={() => {
                              setEditingItem({ directory: key, index, value: record.value });
                              form.setFieldsValue({ newItem: record.value });
                            }}
                          />
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={!canWrite}
                            onClick={() => removeDirectoryItem(key, index)}
                          />
                        </Space>
                      ),
                    },
                  ];
                  dataSource = (data.directories[key] || []).map((it, idx) => ({ key: idx, value: it }));
                }

                // Глобальный поиск по текущей таблице
                const filtered = (dataSource || []).filter((row) => {
                  const q = String(dirSearch || '').toLowerCase();
                  if (!q) return true;
                  return Object.values(row).some((val) => String(val || '').toLowerCase().includes(q));
                });
                return (
                  <TableWithFullscreen
                    title={`Элементы: ${currentDirectory.name}`}
                    infinite={true}
                    batchSize={50}
                    tableProps={{
                      columns,
                      dataSource: filtered,
                      rowKey: 'key',
                      pagination: false,
                      scroll: { x: 600 },
                      size: 'small',
                    }}
                    cardProps={{ bodyStyle: { paddingTop: 8 } }}
                  />
                );
              })()
            }

            {/* Add/Edit Item Form */}
            {editingItem && (
              <Card
                title={
                  editingItem.index !== undefined
                    ? 'Редактирование элемента'
                    : 'Добавление элемента'
                }
                size="small"
                style={{ marginTop: 16 }}
              >
                {editingItem.directory === 'accountTypes' ? (
                  <Form
                    form={form}
                    layout="vertical"
                    onFinish={(values) => {
                      const newObj = {
                        name: values.typeName,
                        permissions: values.permissions || {},
                        allowedWarehouseTypes: Array.isArray(values.allowedWarehouseTypes) ? values.allowedWarehouseTypes : [],
                      };
                      if (editingItem.index !== undefined) {
                        editDirectoryItem(editingItem.directory, editingItem.index, newObj);
                      } else {
                        addDirectoryItem(editingItem.directory, newObj);
                      }
                    }}
                  >
                    <Form.Item
                      name="typeName"
                      label="Название типа"
                      rules={[{ required: true, message: 'Введите название типа' }]}
                    >
                      <Input placeholder="Напр.: Администратор" />
                    </Form.Item>

                    <Row gutter={16}>
                      {['finance', 'warehouse', 'showcase', 'users', 'directories', 'settings', 'requests'].map((res) => (
                        <Col xs={24} sm={12} key={res}>
                          <Form.Item name={["permissions", res]} label={`Права: ${res}`}>
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
                        {(data.directories.warehouseTypes || []).map((t) => (
                          <Option key={t} value={t}>{t}</Option>
                        ))}
                      </Select>
                    </Form.Item>

                    <Form.Item>
                      <Space>
                        <Button type="primary" htmlType="submit">
                          {editingItem.index !== undefined ? 'Сохранить' : 'Добавить'}
                        </Button>
                        <Button onClick={() => setEditingItem(null)}>Отмена</Button>
                      </Space>
                    </Form.Item>
                  </Form>
                ) : editingItem.directory === 'productNames' ? (
                  <Form
                    form={form}
                    layout="vertical"
                    onFinish={(values) => {
                      const newObj = {
                        name: values.productName,
                        type: values.productType,
                      };
                      if (editingItem.index !== undefined) {
                        editDirectoryItem(editingItem.directory, editingItem.index, newObj);
                      } else {
                        addDirectoryItem(editingItem.directory, newObj);
                      }
                    }}
                  >
                    <Row gutter={16}>
                      <Col xs={24} sm={12}>
                        <Form.Item
                          name="productType"
                          label="Тип товара"
                          rules={[{ required: true, message: 'Выберите тип товара' }]}
                        >
                          <Select placeholder="Выберите тип">
                            {(data.directories.productTypes || []).map((t) => (
                              <Option key={t} value={t}>
                                {t}
                              </Option>
                            ))}
                          </Select>
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Form.Item
                          name="productName"
                          label="Название"
                          rules={[{ required: true, message: 'Введите название' }]}
                        >
                          <Input placeholder="Введите название товара" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Form.Item>
                      <Space>
                        <Button type="primary" htmlType="submit">
                          {editingItem.index !== undefined ? 'Сохранить' : 'Добавить'}
                        </Button>
                        <Button onClick={() => setEditingItem(null)}>Отмена</Button>
                      </Space>
                    </Form.Item>
                  </Form>
                ) : (
                  <Form
                    form={form}
                    layout="vertical"
                    onFinish={(values) => {
                      if (editingItem.index !== undefined) {
                        editDirectoryItem(editingItem.directory, editingItem.index, values.newItem);
                      } else {
                        addDirectoryItem(editingItem.directory, values.newItem);
                      }
                    }}
                  >
                    <Form.Item
                      name="newItem"
                      label="Значение элемента"
                      rules={[{ required: true, message: 'Введите значение' }]}
                    >
                      <Input placeholder="Введите значение элемента" />
                    </Form.Item>

                    <Form.Item>
                      <Space>
                        <Button type="primary" htmlType="submit">
                          {editingItem.index !== undefined ? 'Сохранить' : 'Добавить'}
                        </Button>
                        <Button onClick={() => setEditingItem(null)}>Отмена</Button>
                      </Space>
                    </Form.Item>
                  </Form>
                )}
              </Card>
            )}
          </div>
        )}
      </Modal>
      {/* Глобальный поиск по текущему справочнику */}
      {currentDirectory && (
        <div style={{ position: 'fixed', right: 24, bottom: 24 }}>
          <Input
            allowClear
            placeholder={`Поиск по: ${currentDirectory.name}`}
            value={dirSearch}
            onChange={(e) => setDirSearch(e.target.value)}
            style={{ width: 300 }}
          />
        </div>
      )}
    </div>
  );
};

export default Directories;
