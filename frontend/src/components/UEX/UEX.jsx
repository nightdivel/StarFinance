import React, { useEffect, useMemo, useState } from 'react';
import { Card, Space, Form, Input, Button, Select, Typography, Alert, Divider, message } from 'antd';
import { uexApi } from '../../services/uexApiService';
import TableWithFullscreen from '../common/TableWithFullscreen';
import { DownloadOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { APP_DATA_QUERY_KEY } from '../../lib/queries/appData';
import * as XLSX from 'xlsx';
import { compareDropdownStrings } from '../../utils/helpers';

const { Title, Text } = Typography;

const RESOURCES = [
  { value: 'categories', label: 'categories' },
  { value: 'items', label: 'items' },
  { value: 'items_attributes', label: 'items_attributes' },
  { value: 'commodities', label: 'commodities' },
  { value: 'commodities_prices', label: 'commodities_prices' },
  { value: 'commodities_prices_all', label: 'commodities_prices_all' },
  { value: 'commodities_prices_history', label: 'commodities_prices_history' },
  { value: 'fuel_prices', label: 'fuel_prices' },
  { value: 'fuel_prices_all', label: 'fuel_prices_all' },
  { value: 'space_stations', label: 'space_stations' },
  { value: 'planets', label: 'planets' },
  { value: 'moons', label: 'moons' },
  { value: 'terminals', label: 'terminals' },
  { value: 'terminals_distances', label: 'terminals_distances' },
  { value: 'star_systems', label: 'star_systems' },
  { value: 'jump_points', label: 'jump_points' },
  { value: 'cities', label: 'cities' },
  { value: 'companies', label: 'companies' },
  { value: 'organizations', label: 'organizations' },
  { value: 'factions', label: 'factions' },
];

function guessColumns(data) {
  if (!Array.isArray(data) || data.length === 0) return [];
  const sample = data[0] || {};
  const keys = Object.keys(sample).slice(0, 12); // limit columns
  return keys.map((k) => ({
    title: k,
    dataIndex: k,
    key: k,
    render: (v) => (typeof v === 'object' ? JSON.stringify(v) : String(v)),
  }));
}

const UEX = () => {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [listsLoading, setListsLoading] = useState(false);
  const [categories, setCategories] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [catAttributes, setCatAttributes] = useState([]);
  const [terminals, setTerminals] = useState([]);
  const [commodities, setCommodities] = useState([]);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [syncError, setSyncError] = useState(null);

  const tokenInitial = useMemo(() => {
    try { return localStorage.getItem('uex.api.token') || ''; } catch (_) { return ''; }
  }, []);

  // Dynamic params per resource
  const resourceParams = useMemo(() => ({
    items: ['id_category', 'id_company', 'id_vehicle', 'uuid'],
    items_attributes: ['id_item', 'id_category', 'id_category_attribute'],
    commodities_prices: ['id_terminal','id_commodity'],
    commodities_prices_history: ['id_terminal','id_commodity'],
    fuel_prices: ['id_terminal'],
    terminals_distances: ['id_terminal_origin','id_terminal_destination'],
  }), []);

  const visibleFor = (name, res) => {
    const r = res || form.getFieldValue('resource');
    const arr = resourceParams[r] || [];
    return arr.includes(name);
  };


  const onResourceChange = (val) => {
    const all = ['id_category','id_company','id_vehicle','uuid','id_item','id_category_attribute'];
    const keep = new Set(resourceParams[val] || []);
    const patch = {};
    for (const k of all) if (!keep.has(k)) patch[k] = undefined;
    form.setFieldsValue(patch);
    setResult(null);
    setError(null);
  };
  const versionInitial = useMemo(() => {
    try { return localStorage.getItem('uex.client.version') || ''; } catch (_) { return ''; }
  }, []);

  const onSaveCreds = () => {
    const token = form.getFieldValue('token') || '';
    const clientVersion = form.getFieldValue('clientVersion') || '';
    uexApi.setToken(token);
    uexApi.setClientVersion(clientVersion);
  };

  const onSyncDirectories = async () => {
    setSyncError(null);
    setSyncResult(null);
    setSyncLoading(true);
    try {
      const appToken = typeof window !== 'undefined' ? localStorage.getItem('authToken') : '';
      const uexToken = uexApi.getToken ? uexApi.getToken() : (typeof window !== 'undefined' ? localStorage.getItem('uex.api.token') : '');
      const clientVersion = form.getFieldValue('clientVersion') || (typeof window !== 'undefined' ? localStorage.getItem('uex.client.version') : '');
      const resp = await fetch('./api/uex/sync-directories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(appToken ? { Authorization: `Bearer ${appToken}` } : {}),
          ...(uexToken ? { 'x-uex-token': uexToken } : {}),
          ...(clientVersion ? { 'x-uex-client-version': clientVersion } : {}),
        },
        body: JSON.stringify({ full: false }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data || data.success === false) {
        const msg = (data && data.error) || `HTTP ${resp.status}`;
        setSyncError(msg);
        message.error(`Ошибка синхронизации UEX: ${msg}`);
      } else {
        setSyncResult(data);
        message.success('Справочники UEX синхронизированы');
        try {
          // Обновляем агрегированные данные (директории, склад, витрина)
          await queryClient.invalidateQueries({ queryKey: APP_DATA_QUERY_KEY });
        } catch (_) {}
      }
    } catch (e) {
      const msg = e?.message || 'Ошибка запроса';
      setSyncError(msg);
      message.error(`Ошибка синхронизации UEX: ${msg}`);
    } finally {
      setSyncLoading(false);
    }
  };

  // Load lists for selectors
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setListsLoading(true);
        const [cats, comps, vehs, attrs, terms, comms] = await Promise.all([
          uexApi.getCategories().catch(() => []),
          uexApi.getCompanies().catch(() => []),
          uexApi.getVehicles().catch(() => []),
          uexApi.getCategoriesAttributes().catch(() => []),
          uexApi.getTerminals().catch(() => []),
          uexApi.getCommodities().catch(() => []),
        ]);
        if (!mounted) return;
        setCategories(Array.isArray(cats?.data) ? cats.data : Array.isArray(cats) ? cats : []);
        setCompanies(Array.isArray(comps?.data) ? comps.data : Array.isArray(comps) ? comps : []);
        setVehicles(Array.isArray(vehs?.data) ? vehs.data : Array.isArray(vehs) ? vehs : []);
        setCatAttributes(Array.isArray(attrs?.data) ? attrs.data : Array.isArray(attrs) ? attrs : []);
        setTerminals(Array.isArray(terms?.data) ? terms.data : Array.isArray(terms) ? terms : []);
        setCommodities(Array.isArray(comms?.data) ? comms.data : Array.isArray(comms) ? comms : []);
      } finally {
        if (mounted) setListsLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const onRequest = async () => {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const values = await form.validateFields();
      const { resource, path, paramsText } = values;
      let params = undefined;
      if (paramsText) {
        // parse simple key=value&k2=v2 pairs
        params = {};
        const usp = new URLSearchParams(paramsText);
        usp.forEach((v, k) => { params[k] = v; });
      }
      // Auto-apply selectors for known resources
      const id_category = form.getFieldValue('id_category');
      const id_company = form.getFieldValue('id_company');
      const id_vehicle = form.getFieldValue('id_vehicle');
      const uuid = form.getFieldValue('uuid');
      const id_item = form.getFieldValue('id_item');
      const id_category_attribute = form.getFieldValue('id_category_attribute');
      const id_terminal = form.getFieldValue('id_terminal');
      const id_commodity = form.getFieldValue('id_commodity');
      const id_terminal_origin = form.getFieldValue('id_terminal_origin');
      const id_terminal_destination = form.getFieldValue('id_terminal_destination');

      if (resource === 'items') {
        params = { ...(params || {}) };
        if (id_category) params.id_category = id_category;
        if (id_company) params.id_company = id_company;
        if (id_vehicle) params.id_vehicle = id_vehicle;
        if (uuid) params.uuid = uuid;
      }
      if (resource === 'items_attributes') {
        params = { ...(params || {}) };
        if (id_item) params.id_item = id_item;
        if (id_category) params.id_category = id_category;
        if (id_category_attribute) params.id_category_attribute = id_category_attribute;
      }
      if (resource === 'commodities_prices' || resource === 'commodities_prices_history') {
        params = { ...(params || {}) };
        if (id_terminal) params.id_terminal = id_terminal;
        if (id_commodity) params.id_commodity = id_commodity;
      }
      if (resource === 'fuel_prices') {
        params = { ...(params || {}) };
        if (id_terminal) params.id_terminal = id_terminal;
      }
      if (resource === 'terminals_distances') {
        params = { ...(params || {}) };
        if (id_terminal_origin) params.id_terminal_origin = id_terminal_origin;
        if (id_terminal_destination) params.id_terminal_destination = id_terminal_destination;
      }
      const data = await uexApi.get(resource, { path, params });
      setResult(data);
    } catch (e) {
      if (e?.errorFields) {
        // form validation error
      } else {
        setError({ message: e?.message || 'Request failed', status: e?.status, body: e?.body, url: e?.url });
      }
    } finally {
      setLoading(false);
    }
  };

  const tableData = useMemo(() => (Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : null), [result]);
  const [search, setSearch] = useState('');
  const filteredData = useMemo(() => {
    const data = tableData || [];
    const q = (search || '').trim().toLowerCase();
    if (!q) return data;
    return data.filter((row) => {
      try {
        // search across all props by stringifying shallowly
        for (const [k, v] of Object.entries(row || {})) {
          const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
          if (val.toLowerCase().includes(q)) return true;
        }
      } catch (_) {}
      return false;
    });
  }, [tableData, search]);
  const columns = useMemo(() => guessColumns(filteredData || []), [filteredData]);

  const exportExcel = () => {
    try {
      const rows = Array.isArray(filteredData) ? filteredData : [];
      if (!rows.length) return;
      // Build headers union
      const keysSet = new Set();
      const sampleCount = Math.min(rows.length, 200);
      for (let i = 0; i < sampleCount; i++) {
        const r = rows[i] || {};
        Object.keys(r).forEach((k) => keysSet.add(k));
      }
      const headers = Array.from(keysSet);
      // Normalize rows: stringify objects to preserve structure in cells
      const mapped = rows.map((r) => {
        const o = {};
        headers.forEach((h) => {
          const v = r?.[h];
          o[h] = v != null && typeof v === 'object' ? JSON.stringify(v) : v;
        });
        return o;
      });
      const ws = XLSX.utils.json_to_sheet(mapped, { header: headers });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'UEX Export');
      const now = new Date();
      const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
      XLSX.writeFile(wb, `uex_export_${ts}.xlsx`);
    } catch (_) {}
  };

  return (
    <div className="fade-in">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card size="small">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div>
              <Title level={4} style={{ margin: 0 }}>UEX API</Title>
              <Text type="secondary">GET эндпойнты UEX. Введите токен и выполните запрос.</Text>
            </div>
            <Space>
              <Button type="default" onClick={onSyncDirectories} loading={syncLoading}>
                Обновить справочники из UEX
              </Button>
            </Space>
          </div>
          {syncResult && (
            <div style={{ marginTop: 12 }}>
              <Text type="secondary">
                Последняя синхронизация: {syncResult.syncedAt || '—'};
                {' '}типы: +{syncResult.productTypesCreated || 0} / обновлено {syncResult.productTypesUpdated || 0};
                {' '}наименования: +{syncResult.productNamesCreated || 0} / обновлено {syncResult.productNamesUpdated || 0}
              </Text>
            </div>
          )}
          {syncError && (
            <div style={{ marginTop: 8 }}>
              <Alert type="error" message="Ошибка синхронизации справочников UEX" description={syncError} showIcon />
            </div>
          )}
        </Card>

        <Card size="small">
          <Form form={form} layout="vertical" initialValues={{
            token: tokenInitial,
            clientVersion: versionInitial,
            resource: 'categories',
            path: '',
            paramsText: '',
          }}>
            <Form.Item label="Токен UEX API" name="token">
              <Input.Password placeholder="Вставьте токен" onBlur={onSaveCreds} />
            </Form.Item>
            <Form.Item label="X-Client-Version (опционально)" name="clientVersion">
              <Input placeholder="Напр. 1.0.0" onBlur={onSaveCreds} />
            </Form.Item>
            <Form.Item label="Ресурс" name="resource" rules={[{ required: true, message: 'Выберите ресурс' }]}> 
              <Select options={RESOURCES} style={{ maxWidth: 360 }} onChange={onResourceChange} />
            </Form.Item>
            <Form.Item label="Путь (опционально)" name="path">
              <Input placeholder="например: stanton" style={{ maxWidth: 480 }} />
            </Form.Item>
            <Form.Item label="Параметры (URLSearchParams формат)" name="paramsText">
              <Input placeholder="key=value&k2=v2" />
            </Form.Item>

            <Divider>Параметры-подсказки</Divider>
            <Space wrap>
              <Form.Item label="id_category" name="id_category" tooltip="Категории (для items, items_attributes)" hidden={!visibleFor('id_category')}>
                <Select
                  loading={listsLoading}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  style={{ minWidth: 260 }}
                  options={(categories || []).map(c => ({ value: c.id, label: `${c.id} • ${c.section} / ${c.name}` }))}
                />
              </Form.Item>
              <Form.Item label="id_terminal" name="id_terminal" tooltip="Терминал (для commodities_prices, *_history, fuel_prices)" hidden={!visibleFor('id_terminal')}>
                <Select
                  loading={listsLoading}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  style={{ minWidth: 300 }}
                  options={(terminals || []).map(t => ({ value: t.id, label: `${t.id} • ${t.name}` }))}
                />
              </Form.Item>
              <Form.Item label="id_commodity" name="id_commodity" tooltip="Товар (для commodities_prices, *_history)" hidden={!visibleFor('id_commodity')}>
                <Select
                  loading={listsLoading}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  style={{ minWidth: 300 }}
                  options={(commodities || []).map(c => ({ value: c.id, label: `${c.id} • ${c.name}` }))}
                />
              </Form.Item>
              <Form.Item label="id_terminal_origin" name="id_terminal_origin" tooltip="Терминал отправления (для terminals_distances)" hidden={!visibleFor('id_terminal_origin')}>
                <Select
                  loading={listsLoading}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  style={{ minWidth: 300 }}
                  options={(terminals || []).map(t => ({ value: t.id, label: `${t.id} • ${t.name}` }))}
                />
              </Form.Item>
              <Form.Item label="id_terminal_destination" name="id_terminal_destination" tooltip="Терминал назначения (для terminals_distances)" hidden={!visibleFor('id_terminal_destination')}>
                <Select
                  loading={listsLoading}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  style={{ minWidth: 300 }}
                  options={(terminals || []).map(t => ({ value: t.id, label: `${t.id} • ${t.name}` }))}
                />
              </Form.Item>
              <Form.Item label="id_company" name="id_company" tooltip="Компании (для items)" hidden={!visibleFor('id_company')}>
                <Select
                  loading={listsLoading}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  style={{ minWidth: 260 }}
                  options={(companies || []).map(c => ({ value: c.id, label: `${c.id} • ${c.name}` }))}
                />
              </Form.Item>
              <Form.Item label="id_vehicle" name="id_vehicle" tooltip="Техника (для items)" hidden={!visibleFor('id_vehicle')}>
                <Select
                  loading={listsLoading}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  style={{ minWidth: 260 }}
                  options={(vehicles || []).map(v => ({ value: v.id, label: `${v.id} • ${v.name}` }))}
                />
              </Form.Item>
              <Form.Item label="uuid" name="uuid" tooltip="UUID предмета (для items)" hidden={!visibleFor('uuid')}>
                <Input style={{ minWidth: 260 }} placeholder="uuid" />
              </Form.Item>
              <Form.Item label="id_item" name="id_item" tooltip="ID предмета (для items_attributes)" hidden={!visibleFor('id_item')}>
                <Input style={{ minWidth: 180 }} placeholder="id_item" />
              </Form.Item>
              <Form.Item label="id_category_attribute" name="id_category_attribute" tooltip="Атрибут категории (для items_attributes)" hidden={!visibleFor('id_category_attribute')}>
                <Select
                  loading={listsLoading}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  style={{ minWidth: 300 }}
                  options={(catAttributes || [])
                    .filter(a => {
                      const selectedCat = form.getFieldValue('id_category');
                      if (!selectedCat) return true;
                      const aCatId = a.category_id ?? a.categoryId ?? a.category?.id;
                      return !aCatId || String(aCatId) === String(selectedCat);
                    })
                    .map(a => ({ value: a.id, label: `${a.id} • ${a.category?.name || a.category || ''} / ${a.name}` }))}
                />
              </Form.Item>
            </Space>
            <div style={{ marginTop: 12 }}>
              <Space>
                <Button type="primary" onClick={onRequest} loading={loading}>Запросить</Button>
                <Button onClick={() => setResult(null)}>Очистить</Button>
              </Space>
            </div>
          </Form>
        </Card>

        {error && (
          <Alert
            type="error"
            message={`Ошибка запроса${error.status ? ' ' + error.status : ''}`}
            description={
              <div>
                {error.url ? (<div style={{ marginBottom: 8 }}><Text code>{error.url}</Text></div>) : null}
                <pre style={{ whiteSpace: 'pre-wrap' }}>{error.body || error.message}</pre>
              </div>
            }
            showIcon
          />
        )}

        {tableData ? (
          <TableWithFullscreen
            title={<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span>Результаты</span>
              <Input
                allowClear
                size="small"
                placeholder="Поиск по всем полям"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ maxWidth: 260 }}
              />
              <Button size="small" icon={<DownloadOutlined />} onClick={exportExcel} disabled={!filteredData || filteredData.length === 0}>
                Экспорт Excel
              </Button>
            </div>}
            tableProps={{
              size: 'small',
              rowKey: (r, idx) => r?.id || r?.uuid || idx,
              dataSource: filteredData,
              columns,
            }}
            batchSize={50}
            infinite
          />
        ) : result ? (
          <Card size="small">
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</pre>
          </Card>
        ) : null}
      </Space>
    </div>
  );
};

export default UEX;
