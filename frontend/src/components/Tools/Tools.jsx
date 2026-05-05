import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Checkbox,
  Col,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popover,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  PlusOutlined,
  PlayCircleOutlined,
  SendOutlined,
  ToolOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import Draggable from 'react-draggable';
import { apiService } from '../../services/apiService';
import { authService } from '../../services/authService';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

// ──────────────────────────────────────────────────────────────────
// Postman-style collapsible JSON tree with syntax highlighting
// ──────────────────────────────────────────────────────────────────
const JC = {
  key:     '#66d9e8',
  str:     '#a6e22e',
  num:     '#fd971f',
  bool:    '#ae81ff',
  nil:     '#f92672',
  bracket: '#f8f8f2',
  meta:    '#75715e',
};

const MAX_STR_LEN = 300;

function JValue({ value, isLast, depth }) {
  const [open, setOpen] = useState(depth < 2);
  const comma = !isLast ? <span style={{ color: JC.meta }}>,</span> : null;

  if (value === null || value === undefined)
    return <span><span style={{ color: JC.nil }}>null</span>{comma}</span>;
  if (typeof value === 'boolean')
    return <span><span style={{ color: JC.bool }}>{String(value)}</span>{comma}</span>;
  if (typeof value === 'number')
    return <span><span style={{ color: JC.num }}>{value}</span>{comma}</span>;
  if (typeof value === 'string') {
    const display = value.length > MAX_STR_LEN ? value.slice(0, MAX_STR_LEN) + '…' : value;
    return <span><span style={{ color: JC.str }}>{'"'}{display}{'"'}</span>{comma}</span>;
  }

  if (Array.isArray(value)) {
    if (!open) return (
      <span>
        <span title="Развернуть" style={{ cursor: 'pointer', color: JC.meta, userSelect: 'none' }} onClick={() => setOpen(true)}>
          ▶ [<span style={{ color: JC.num }}>{value.length}</span>]
        </span>{comma}
      </span>
    );
    return (
      <span>
        <span style={{ cursor: 'pointer', color: JC.bracket, userSelect: 'none' }} onClick={() => setOpen(false)}>▼ [</span>
        <div style={{ paddingLeft: 16 }}>
          {value.map((item, i) => (
            <div key={i}><JValue value={item} isLast={i === value.length - 1} depth={depth + 1} /></div>
          ))}
        </div>
        <span style={{ color: JC.bracket }}>]</span>{comma}
      </span>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (!open) return (
      <span>
        <span title="Развернуть" style={{ cursor: 'pointer', color: JC.meta, userSelect: 'none' }} onClick={() => setOpen(true)}>
          ▶ {'{'}<span style={{ color: JC.num }}>{entries.length}</span>{'}'}
        </span>{comma}
      </span>
    );
    return (
      <span>
        <span style={{ cursor: 'pointer', color: JC.bracket, userSelect: 'none' }} onClick={() => setOpen(false)}>▼ {'{'}</span>
        <div style={{ paddingLeft: 16 }}>
          {entries.map(([k, v], i) => (
            <div key={k} style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 0 }}>
              <span style={{ color: JC.key, flexShrink: 0 }}>{'"'}{k}{'"'}</span>
              <span style={{ color: JC.meta, flexShrink: 0, margin: '0 4px 0 0' }}>:</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <JValue value={v} isLast={i === entries.length - 1} depth={depth + 1} />
              </span>
            </div>
          ))}
        </div>
        <span style={{ color: JC.bracket }}>{'}'}</span>{comma}
      </span>
    );
  }

  return <span style={{ color: JC.str }}>{String(value)}</span>;
}

function JsonTreeViewer({ data }) {
  if (!data) return null;
  const output = data?.output ?? data;
  const status = data?.status;
  const errorMsg = data?.error;
  const isEmpty = !output ||
    (typeof output === 'object' && !Array.isArray(output) && Object.keys(output).length === 0);

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      {status && (
        <Space>
          <Tag color={status === 'success' ? 'success' : 'error'}>{status}</Tag>
          {errorMsg && <Text type="danger">{errorMsg}</Text>}
        </Space>
      )}
      {!errorMsg && !isEmpty && (
        <div style={{
          background: '#1b1e2e',
          borderRadius: 6,
          padding: '10px 14px',
          fontFamily: '"Fira Mono","Cascadia Code","Consolas",monospace',
          fontSize: 12,
          lineHeight: '1.7',
          overflow: 'auto',
          maxHeight: 520,
          color: JC.bracket,
          border: '1px solid #2e3250',
        }}>
          <JValue value={output} isLast depth={0} />
        </div>
      )}
      {isEmpty && !errorMsg && <Text type="secondary">Ответ пуст</Text>}
    </Space>
  );
}

// ──────────────────────────────────────────────────────────────────
// TableViewer: drill-down table with column/row visibility toggles
// ──────────────────────────────────────────────────────────────────
function TableViewer({ data }) {
  const output = useMemo(() => data?.output ?? data, [data]);
  const [path, setPath] = useState([]);
  // hiddenFields keyed by serialised path → Set of hidden field names/indices
  const [hiddenFields, setHiddenFields] = useState({});

  // Reset when data changes (modal re-opened for different tool)
  useEffect(() => { setPath([]); setHiddenFields({}); }, [data]);

  const current = useMemo(() => {
    let node = output;
    for (const step of path) node = node?.[step];
    return node;
  }, [output, path]);

  const pathKey = path.join('\0');
  const hidden = hiddenFields[pathKey] ?? new Set();

  const toggleField = (field) => {
    setHiddenFields(prev => {
      const cur = new Set(prev[pathKey] ?? []);
      cur.has(field) ? cur.delete(field) : cur.add(field);
      return { ...prev, [pathKey]: new Set(cur) };
    });
  };

  const drillDown = (...keys) => setPath(p => [...p, ...keys]);

  const renderCell = (val, ...drillKeys) => {
    if (val === null || val === undefined) return <span style={{ color: '#888' }}>—</span>;
    if (typeof val === 'boolean')
      return <Tag color={val ? 'success' : 'default'} style={{ fontSize: 11 }}>{String(val)}</Tag>;
    if (typeof val !== 'object') {
      const s = String(val);
      return <Text style={{ fontSize: 12 }}>{s.length > 120 ? s.slice(0, 120) + '…' : s}</Text>;
    }
    const count = Array.isArray(val) ? val.length : Object.keys(val).length;
    const label = Array.isArray(val) ? `[${count}]` : `{${count}}`;
    return (
      <Button
        size="small" type="link"
        style={{ padding: 0, fontSize: 11, height: 'auto', lineHeight: '20px' }}
        onClick={() => drillDown(...drillKeys)}
      >
        {label}
      </Button>
    );
  };

  // ── Breadcrumb ──
  const breadcrumb = (
    <Space size={2} wrap style={{ marginBottom: 6 }}>
      <Button size="small" type={path.length === 0 ? 'primary' : 'default'} onClick={() => setPath([])}>
        root
      </Button>
      {path.map((step, i) => (
        <React.Fragment key={i}>
          <Text type="secondary" style={{ fontSize: 12 }}>/</Text>
          <Button
            size="small"
            type={i === path.length - 1 ? 'primary' : 'default'}
            onClick={() => setPath(path.slice(0, i + 1))}
          >
            {String(step)}
          </Button>
        </React.Fragment>
      ))}
    </Space>
  );

  // ── Field toggle popover content ──
  const fieldToggle = (fields, label) => {
    const content = (
      <div style={{ maxHeight: 300, overflowY: 'auto', minWidth: 160 }}>
        {fields.map(f => (
          <div key={f} style={{ padding: '3px 0' }}>
            <Checkbox
              checked={!hidden.has(f)}
              onChange={() => toggleField(f)}
            >
              <span style={{ fontSize: 12 }}>{String(f)}</span>
            </Checkbox>
          </div>
        ))}
      </div>
    );
    const visible = fields.filter(f => !hidden.has(f)).length;
    return (
      <Popover content={content} title={label} trigger="click" placement="bottomLeft">
        <Button size="small" style={{ marginBottom: 6 }}>
          {label} ({visible}/{fields.length}) ▾
        </Button>
      </Popover>
    );
  };

  if (current === null || current === undefined)
    return <Space direction="vertical" style={{ width: '100%' }} size={4}>{breadcrumb}<Text type="secondary">null</Text></Space>;

  if (typeof current !== 'object')
    return <Space direction="vertical" style={{ width: '100%' }} size={4}>{breadcrumb}<Text copyable style={{ fontSize: 13 }}>{String(current)}</Text></Space>;

  // ── Array of objects → column-per-key table ──
  if (Array.isArray(current) && current.length > 0 &&
    current.some(v => v !== null && typeof v === 'object' && !Array.isArray(v))) {
    const allKeys = Array.from(new Set(
      current.flatMap(item => (item !== null && typeof item === 'object' ? Object.keys(item) : []))
    ));
    const visibleKeys = allKeys.filter(k => !hidden.has(k));

    const columns = [
      {
        key: '_i', title: '#', width: 48, fixed: 'left',
        render: (_, row) => <Text type="secondary" style={{ fontSize: 11 }}>{row._rowIdx}</Text>,
      },
      ...visibleKeys.map(k => ({
        key: k,
        title: <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{k}</span>,
        dataIndex: k,
        ellipsis: true,
        width: 150,
        render: (val, row) => renderCell(val, row._rowIdx, k),
      })),
    ];

    return (
      <Space direction="vertical" style={{ width: '100%' }} size={4}>
        {breadcrumb}
        {fieldToggle(allKeys, 'Столбцы')}
        <Table
          size="small"
          dataSource={current.map((row, i) => ({
            ...(row !== null && typeof row === 'object' ? row : { value: row }),
            _rowKey: `r${i}`,
            _rowIdx: i,
          }))}
          rowKey="_rowKey"
          columns={columns}
          pagination={current.length > 50 ? { pageSize: 50, size: 'small', showSizeChanger: false } : false}
          scroll={{ x: visibleKeys.length * 150 + 48, y: 400 }}
        />
      </Space>
    );
  }

  // ── Array of primitives or mixed ──
  if (Array.isArray(current)) {
    const allIndexes = current.map((_, i) => String(i));
    const visibleData = current
      .map((val, i) => ({ key: String(i), idx: i, val }))
      .filter(row => !hidden.has(String(row.idx)));

    const columns = [
      { key: 'idx', dataIndex: 'idx', title: '#', width: 60 },
      { key: 'val', dataIndex: 'val', title: 'Значение', render: (val, row) => renderCell(val, row.idx) },
    ];

    return (
      <Space direction="vertical" style={{ width: '100%' }} size={4}>
        {breadcrumb}
        {fieldToggle(allIndexes, 'Строки')}
        <Table size="small" dataSource={visibleData} columns={columns}
          pagination={visibleData.length > 100 ? { pageSize: 100, size: 'small' } : false}
          scroll={{ y: 400 }} />
      </Space>
    );
  }

  // ── Plain object → key / value rows ──
  const allKeys = Object.keys(current);
  const visibleKeys = allKeys.filter(k => !hidden.has(k));
  const tableData = visibleKeys.map(k => ({ key: k, field: k, value: current[k] }));
  const columns = [
    {
      key: 'field', dataIndex: 'field', title: 'Ключ', width: 200, fixed: 'left',
      render: v => <Text strong style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      key: 'value', dataIndex: 'value', title: 'Значение',
      render: (val, row) => renderCell(val, row.field),
    },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={4}>
      {breadcrumb}
      {fieldToggle(allKeys, 'Строки')}
      <Table size="small" dataSource={tableData} columns={columns}
        pagination={false} scroll={{ y: 420 }} />
    </Space>
  );
}

// ──────────────────────────────────────────────────────────────────
// DraggableResizableModal
// ──────────────────────────────────────────────────────────────────
const DEFAULT_W = Math.min(1200, Math.round(window.innerWidth * 0.88));
const DEFAULT_H = Math.min(800, Math.round(window.innerHeight * 0.82));

// Исправленный DraggableResizableModal
function DraggableResizableModal({ title, open, onClose, children }) {
  const dragRef = useRef(null);
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });
  const resizing = useRef(false);
  const resizeStart = useRef({});
  const [disabled, setDisabled] = useState(true);

  useEffect(() => {
    if (open) setSize({ w: DEFAULT_W, h: DEFAULT_H });
  }, [open]);

  // Drag and resize logic
  const onResizeMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    const onMove = (ev) => {
      if (!resizing.current) return;
      const dw = ev.clientX - resizeStart.current.x;
      const dh = ev.clientY - resizeStart.current.y;
      setSize({
        w: Math.max(400, resizeStart.current.w + dw),
        h: Math.max(300, resizeStart.current.h + dh),
      });
    };
    const onUp = () => {
      resizing.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [size]);

  const modalRender = useCallback((modal) => {
    // Переносим dragRef на .ant-modal-root, чтобы перетаскивать всё окно
    return (
      <Draggable
        disabled={disabled}
        handle=".draggable-modal-handle"
        nodeRef={dragRef}
      >
        <div ref={dragRef} style={{ position: 'relative', width: size.w, height: size.h }}>
          {React.cloneElement(modal, {
            style: {
              ...modal.props.style,
              width: size.w,
              height: size.h,
              maxWidth: '100vw',
              maxHeight: '100vh',
            },
            bodyStyle: {
              ...modal.props.bodyStyle,
              height: size.h - 110,
              overflow: 'auto',
              padding: '12px 16px',
            },
          })}
          {/* Resize handle — bottom-right corner */}
          <div
            onMouseDown={onResizeMouseDown}
            style={{
              position: 'absolute',
              right: 0,
              bottom: 0,
              width: 18,
              height: 18,
              cursor: 'nwse-resize',
              zIndex: 10,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'flex-end',
              padding: 3,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 9L9 1M5 9L9 5M9 9L9 9" stroke="#aaa" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
        </div>
      </Draggable>
    );
  }, [disabled, size, onResizeMouseDown]);

  return (
    <Modal
      title={
        <div
          className="draggable-modal-handle"
          onMouseOver={() => setDisabled(false)}
          onMouseOut={() => setDisabled(true)}
          onFocus={() => setDisabled(false)}
          onBlur={() => setDisabled(true)}
          style={{ cursor: 'move', userSelect: 'none', paddingRight: 40 }}
        >
          {title}
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="close" type="primary" onClick={onClose}>Закрыть</Button>,
      ]}
      width={size.w}
      bodyStyle={{ height: size.h - 110, overflow: 'auto', padding: '12px 16px' }}
      modalRender={modalRender}
      maskClosable={true}
    >
      {children}
    </Modal>
  );
}

const ACTION_META = {
  open_url: {
    label: 'Переход по ссылке',
    color: 'blue',
    icon: <LinkOutlined />,
    risk: 'Low',
    tooltip: 'Открывает внешний HTTP/HTTPS ресурс. Удобно для быстрых переходов в панели оператора.',
  },
  rest_call: {
    label: 'REST API',
    color: 'volcano',
    icon: <ToolOutlined />,
    risk: 'High',
    tooltip: 'Вызывает внешний API endpoint. Используйте для интеграций, синхронизаций и служебных команд.',
  },
  telegram_send: {
    label: 'Telegram',
    color: 'cyan',
    icon: <SendOutlined />,
    risk: 'Medium',
    tooltip: 'Отправляет шаблонное сообщение в группу или канал Telegram через бота.',
  },
  discord_send: {
    label: 'Discord',
    color: 'geekblue',
    icon: <SendOutlined />,
    risk: 'Medium',
    tooltip: 'Публикует сообщение в Discord через webhook, удобно для уведомлений и алертов.',
  },
};

const DEFAULT_FORM_VALUES = {
  title: '',
  description: '',
  category: '',
  actionType: 'open_url',
  iconSource: 'external_url',
  iconUrl: '',
  iconFilePath: '',
  isActive: true,
  sortOrder: 100,
  openUrl: '',
  openMode: 'new_tab',
  restMethod: 'POST',
  restUrl: '',
  restTimeoutMs: 10000,
  restHeadersJson: '{\n  "Content-Type": "application/json"\n}',
  restAuthType: 'none',
  restTokenEnv: 'TOOLS_API_TOKEN',
  restBodyTemplateJson: '{\n  "source": "starfinance",\n  "user": "{{currentUser.username}}"\n}',
  telegramBotTokenEnv: 'TELEGRAM_BOT_TOKEN',
  telegramChatId: '',
  telegramParseMode: 'Markdown',
  telegramMessageTemplate: '{{currentUser.nickname}} запустил инструмент {{tool.title}}',
  discordWebhookUrlEnv: 'DISCORD_TOOLS_WEBHOOK_URL',
  discordUsername: 'StarFinance Bot',
  discordMessageTemplate: 'Инструмент {{tool.title}} выполнен пользователем {{currentUser.username}}',
};

function safeParseJson(text, fallback) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed;
    return fallback;
  } catch {
    return fallback;
  }
}

function formatJson(value) {
  try {
    return JSON.stringify(value || {}, null, 2);
  } catch {
    return '{}';
  }
}

function buildFormValues(tool) {
  if (!tool) return DEFAULT_FORM_VALUES;
  const config = tool.config || {};
  return {
    title: tool.title || '',
    description: tool.description || '',
    category: tool.category || '',
    actionType: tool.actionType || 'open_url',
    iconSource: tool.iconSource || 'external_url',
    iconUrl: tool.iconUrl || '',
    iconFilePath: tool.iconFilePath || '',
    isActive: tool.isActive !== false,
    sortOrder: tool.sortOrder || 100,
    openUrl: config.url || '',
    openMode: config.openMode || 'new_tab',
    restMethod: config.method || 'POST',
    restUrl: config.url || '',
    restTimeoutMs: config.timeoutMs || 10000,
    restHeadersJson: formatJson(config.headers || { 'Content-Type': 'application/json' }),
    restAuthType: config.auth?.type || 'none',
    restTokenEnv: config.auth?.tokenEnv || 'TOOLS_API_TOKEN',
    restBasicUser: config.auth?.basicUser || '',
    restBasicPass: config.auth?.basicPass || '',
    restApiKey: config.auth?.apiKey || '',
    restApiKeyValue: config.auth?.apiKeyValue || '',
    restApiKeyIn: config.auth?.apiKeyIn || 'header',
    restBodyTemplateJson: formatJson(config.bodyTemplate || { source: 'starfinance', user: '{{currentUser.username}}' }),
    telegramBotTokenEnv: config.botTokenEnv || 'TELEGRAM_BOT_TOKEN',
    telegramChatId: config.chatId || '',
    telegramParseMode: config.parseMode || 'Markdown',
    telegramMessageTemplate: config.messageTemplate || DEFAULT_FORM_VALUES.telegramMessageTemplate,
    discordWebhookUrlEnv: config.webhookUrlEnv || 'DISCORD_TOOLS_WEBHOOK_URL',
    discordUsername: config.username || 'StarFinance Bot',
    discordMessageTemplate: config.messageTemplate || DEFAULT_FORM_VALUES.discordMessageTemplate,
  };
}

function buildPayload(values, uploadedIcon) {
  const payload = {
    title: values.title,
    description: values.description,
    category: values.category,
    actionType: values.actionType,
    iconSource: values.iconSource,
    iconUrl: values.iconSource === 'external_url' ? values.iconUrl : uploadedIcon?.url || values.iconUrl,
    iconFilePath: values.iconSource === 'upload' ? uploadedIcon?.filePath || values.iconFilePath : '',
    isActive: values.isActive,
    sortOrder: values.sortOrder,
    config: {},
  };

  if (values.actionType === 'open_url') {
    payload.config = {
      url: values.openUrl,
      openMode: values.openMode,
    };
  }

  if (values.actionType === 'rest_call') {
    const auth = {};
    if (values.restAuthType === 'bearer_env') {
      auth.type = 'bearer_env';
      auth.tokenEnv = values.restTokenEnv;
    }
    if (values.restAuthType === 'basic' || values.restAuthType === 'basic+apiKey') {
      auth.type = auth.type ? auth.type + '+basic' : 'basic';
      auth.basicUser = values.restBasicUser;
      auth.basicPass = values.restBasicPass;
    }
    if (values.restAuthType === 'apiKey' || values.restAuthType === 'basic+apiKey') {
      auth.type = auth.type ? auth.type + '+apiKey' : 'apiKey';
      auth.apiKey = values.restApiKey;
      auth.apiKeyValue = values.restApiKeyValue;
      auth.apiKeyIn = values.restApiKeyIn;
    }
    payload.config = {
      method: values.restMethod,
      url: values.restUrl,
      timeoutMs: values.restTimeoutMs,
      headers: safeParseJson(values.restHeadersJson, {}),
      auth,
      bodyTemplate: safeParseJson(values.restBodyTemplateJson, {}),
    };
  }

  if (values.actionType === 'telegram_send') {
    payload.config = {
      botTokenEnv: values.telegramBotTokenEnv,
      chatId: values.telegramChatId,
      parseMode: values.telegramParseMode,
      messageTemplate: values.telegramMessageTemplate,
    };
  }

  if (values.actionType === 'discord_send') {
    payload.config = {
      webhookUrlEnv: values.discordWebhookUrlEnv,
      username: values.discordUsername,
      messageTemplate: values.discordMessageTemplate,
    };
  }

  return payload;
}

function resolveToolIconSrc(tool) {
  const externalUrl = String(tool?.iconUrl || '').trim();
  if (externalUrl && /^https?:\/\//i.test(externalUrl)) {
    const proxiedPath = `/api/tools/icon-proxy?url=${encodeURIComponent(externalUrl)}`;
    return apiService.buildUrl(proxiedPath);
  }
  const localPath = String(tool?.iconFilePath || '').trim();
  if (localPath) return localPath;
  return undefined;
}

function renderInfoLabel(label, tooltip) {
  return (
    <Space size={4}>
      <span>{label}</span>
      <Tooltip title={tooltip}>
        <InfoCircleOutlined />
      </Tooltip>
    </Space>
  );
}

function ToolActionBadge({ actionType }) {
  const meta = ACTION_META[actionType] || ACTION_META.open_url;
  return (
    <Tag color={meta.color} icon={meta.icon}>
      {meta.label}
    </Tag>
  );
}

function ToolCard({ tool, onRun, running }) {
  return (
    <Button
      type="default"
      block
      size="large"
      icon={<PlayCircleOutlined />}
      loading={running}
      disabled={!tool.isActive || running}
      onClick={() => onRun(tool)}
      style={{ height: '100%', minHeight: 140, padding: 12 }}
    >
      <Space direction="vertical" align="center" size={10} style={{ width: '100%', justifyContent: 'center' }}>
        <Avatar shape="square" size={56} src={resolveToolIconSrc(tool)} icon={<ToolOutlined />} />
        <Text strong style={{ maxWidth: '100%', textAlign: 'center' }} ellipsis>
          {tool.title}
        </Text>
        {tool.description ? (
          <Text type="secondary" style={{ fontSize: 12, textAlign: 'center', whiteSpace: 'normal', maxWidth: 180 }}>
            {tool.description}
          </Text>
        ) : null}
      </Space>
    </Button>
  );
}

function Tools({ userData, onRefresh }) {
    const [toolsSettings, setToolsSettings] = useState({ toolsHistoryAutoClearMonths: 3 });
  const [tools, setTools] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [runsLoading, setRunsLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [editingTool, setEditingTool] = useState(null);
  const [activeTab, setActiveTab] = useState('catalog');
  const [runningToolId, setRunningToolId] = useState('');
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [lastRunResult, setLastRunResult] = useState(null);
  const [lastRunTitle, setLastRunTitle] = useState('');
  const [iconFileList, setIconFileList] = useState([]);
  const [toolForm] = Form.useForm();

  const canWrite = authService.hasPermission('tools', 'write') || userData?.accountType === 'Администратор';

  const loadTools = async () => {
    setLoading(true);
    try {
      const response = await apiService.getTools();
      setTools(Array.isArray(response?.items) ? response.items : []);
    } catch (error) {
      message.error(error.message || 'Не удалось загрузить инструменты');
    } finally {
      setLoading(false);
    }
  };

  const loadRuns = async () => {
    setRunsLoading(true);
    try {
      const response = await apiService.getToolRuns();
      setRuns(Array.isArray(response?.items) ? response.items : []);
    } catch (error) {
      message.error(error.message || 'Не удалось загрузить историю запусков');
    } finally {
      setRunsLoading(false);
    }
  };

  // Автоочистка истории запусков инструментов
  useEffect(() => {
    const init = async () => {
      await loadTools();
      // Получаем настройки автоочистки
      let settings = { toolsHistoryAutoClearMonths: 3 };
      try {
        const s = await apiService.getToolsSettings();
        if (s && typeof s.toolsHistoryAutoClearMonths === 'number') settings = s;
      } catch (_) {}
      setToolsSettings(settings);
      // Загружаем историю запусков
      const response = await apiService.getToolRuns();
      const runsArr = Array.isArray(response?.items) ? response.items : [];
      setRuns(runsArr);
      // Проверяем, требуется ли автоочистка
      if (runsArr.length > 0 && settings.toolsHistoryAutoClearMonths > 0) {
        const now = Date.now();
        const msLimit = settings.toolsHistoryAutoClearMonths * 30 * 24 * 60 * 60 * 1000;
        const oldest = Math.min(...runsArr.map(r => new Date(r.createdAt || r.timestamp || r.date || 0).getTime()));
        if (now - oldest > msLimit) {
          // Only attempt auto-clear if user has write permission for tools
          if (canWrite) {
            try {
              await apiService.deleteToolRuns();
              message.info('История запусков инструментов автоматически очищена по истечении срока.');
              await loadRuns();
            } catch (_) {}
          }
        }
      }
    };
    init();
  }, []);

  const sortedTools = useMemo(
    () => [...tools].sort((left, right) => (left.sortOrder || 100) - (right.sortOrder || 100)),
    [tools]
  );

  const activeCatalogTools = useMemo(
    () => sortedTools.filter((tool) => tool.isActive),
    [sortedTools]
  );

  const openCreateModal = () => {
    setEditingTool(null);
    setIconFileList([]);
    toolForm.setFieldsValue(DEFAULT_FORM_VALUES);
    setModalOpen(true);
  };

  const openEditModal = (tool) => {
    setEditingTool(tool);
    setIconFileList([]);
    toolForm.setFieldsValue(buildFormValues(tool));
    setModalOpen(true);
  };

  const handleDelete = (tool) => {
    Modal.confirm({
      title: 'Удалить инструмент?',
      content: 'После удаления кнопка исчезнет из каталога, но история запусков сохранится.',
      okText: 'Удалить',
      okButtonProps: { danger: true },
      cancelText: 'Отмена',
      onOk: async () => {
        try {
          await apiService.deleteTool(tool.id);
          message.success('Инструмент удален');
          await loadTools();
          await loadRuns();
          if (typeof onRefresh === 'function') await onRefresh();
        } catch (error) {
          message.error(error.message || 'Не удалось удалить инструмент');
        }
      },
    });
  };

  const handleSave = async () => {
    try {
      const values = await toolForm.validateFields();
      setSaving(true);
      let uploadedIcon = null;
      if (values.iconSource === 'upload' && iconFileList[0]?.originFileObj) {
        uploadedIcon = await apiService.uploadToolIcon(iconFileList[0].originFileObj);
      }
      const payload = buildPayload(values, uploadedIcon);
      if (editingTool?.id) payload.id = editingTool.id;
      await apiService.saveTool({ ...payload, id: editingTool?.id });
      message.success(editingTool ? 'Инструмент обновлен' : 'Инструмент создан');
      setModalOpen(false);
      setEditingTool(null);
      setIconFileList([]);
      toolForm.resetFields();
      await loadTools();
      if (typeof onRefresh === 'function') await onRefresh();
    } catch (error) {
      if (error?.errorFields) return;
      message.error(error.message || 'Не удалось сохранить инструмент');
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async (tool) => {
    try {
      setRunning(true);
      setRunningToolId(tool.id);
      const response = await apiService.runTool(tool.id, {});
      message.success('Инструмент выполнен');
      if (tool.actionType === 'rest_call') {
        setLastRunTitle(tool.title);
        setLastRunResult(response);
        setResultModalOpen(true);
      }
      if (response?.output?.openUrl) {
        window.open(response.output.openUrl, response.output.openMode === 'same_tab' ? '_self' : '_blank', 'noopener,noreferrer');
      }
      await loadRuns();
    } catch (error) {
      if (tool.actionType === 'rest_call') {
        setLastRunTitle(tool.title);
        setLastRunResult({
          status: 'failed',
          error: error.message || 'Не удалось выполнить инструмент',
        });
        setResultModalOpen(true);
      }
      message.error(error.message || 'Не удалось выполнить инструмент');
    } finally {
      setRunningToolId('');
      setRunning(false);
    }
  };

  const currentActionType = Form.useWatch('actionType', toolForm) || 'open_url';
  const currentIconSource = Form.useWatch('iconSource', toolForm) || 'external_url';
  const currentAuthType = Form.useWatch('restAuthType', toolForm) || 'none';

  const runColumns = [
    {
      title: 'Инструмент',
      dataIndex: 'toolTitle',
      key: 'toolTitle',
      render: (value, record) => (
        <Tooltip title="Какой инструмент был выполнен и для какого действия использовался этот запуск.">
          <span>{value || record.toolId}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      key: 'status',
      render: (status) => {
        const color = status === 'success' ? 'green' : status === 'failed' ? 'red' : 'gold';
        return <Tag color={color}>{status}</Tag>;
      },
    },
    {
      title: 'Кто запустил',
      dataIndex: 'initiatedUsername',
      key: 'initiatedUsername',
      render: (value) => value || 'Системный запуск',
    },
    {
      title: 'Время',
      dataIndex: 'startedAt',
      key: 'startedAt',
      render: (value) => (value ? new Date(value).toLocaleString() : '-'),
    },
    {
      title: 'Ошибка',
      dataIndex: 'errorMessage',
      key: 'errorMessage',
      render: (value) => (
        <Tooltip title={value || 'Ошибок нет'}>
          <span>{value ? String(value).slice(0, 48) : '-'}</span>
        </Tooltip>
      ),
    },
  ];

  const tabItems = [
    {
      key: 'catalog',
      label: 'Каталог',
      children: activeCatalogTools.length ? (
        <Row gutter={[16, 16]}>
          {activeCatalogTools.map((tool) => (
            <Col xs={24} md={12} xl={8} key={tool.id}>
              <ToolCard
                tool={tool}
                onRun={handleRun}
                running={running && runningToolId === tool.id}
              />
            </Col>
          ))}
        </Row>
      ) : (
        <Card>
          <Empty description="Инструменты еще не добавлены" />
        </Card>
      ),
    },
    canWrite
      ? {
          key: 'manage',
          label: 'Управление',
          children: (
            <Card>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Alert
                  type="info"
                  showIcon
                  message="Добавляйте кнопки осознанно"
                  description="REST API и отправка сообщений во внешние каналы имеют больший операционный риск. Для таких кнопок заполняйте описание максимально конкретно, чтобы пользователь понимал, что произойдет при запуске."
                />
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
                  Добавить инструмент
                </Button>
                <List
                  dataSource={sortedTools}
                  locale={{ emptyText: 'Нет инструментов для управления' }}
                  renderItem={(tool) => (
                    <List.Item
                      actions={[
                        <Tooltip key="edit" title="Редактировать конфигурацию инструмента">
                          <Button icon={<EditOutlined />} onClick={() => openEditModal(tool)}>
                            Изменить
                          </Button>
                        </Tooltip>,
                        <Tooltip key="delete" title="Удалить инструмент из каталога">
                          <Button danger icon={<DeleteOutlined />} onClick={() => handleDelete(tool)}>
                            Удалить
                          </Button>
                        </Tooltip>,
                      ]}
                    >
                      <List.Item.Meta
                        avatar={<Avatar shape="square" src={resolveToolIconSrc(tool)} icon={<ToolOutlined />} />}
                        title={<Space wrap><span>{tool.title}</span><ToolActionBadge actionType={tool.actionType} /></Space>}
                        description={tool.description || 'Описание не заполнено'}
                      />
                    </List.Item>
                  )}
                />
              </Space>
            </Card>
          ),
        }
      : null,
    {
      key: 'history',
      label: 'История',
      children: (
        <Card>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space style={{ justifyContent: 'space-between', width: '100%' }}>
              <span>История запусков инструментов</span>
              <Tooltip title={canWrite ? 'Очистить историю' : 'Недостаточно прав'}>
                <Button danger icon={<DeleteOutlined />} onClick={async () => {
                  try {
                    await apiService.deleteToolRuns();
                    message.success('История запусков очищена');
                    await loadRuns();
                  } catch (e) {
                    message.error('Ошибка при очистке истории');
                  }
                }} disabled={!canWrite}>Очистить историю</Button>
              </Tooltip>
            </Space>
            <Table rowKey="id" loading={runsLoading} columns={runColumns} dataSource={runs} pagination={{ pageSize: 8 }} />
          </Space>
        </Card>
      ),
    },
  ].filter(Boolean);

  return (
    <div className="fade-in">
      <Card size="small" className="mb-3">
        <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }} wrap>
          <div>
            <Space align="center">
              <Title level={3} style={{ margin: 0 }}>
                <ToolOutlined /> Инструменты
              </Title>
              <Tooltip title="Раздел для кастомных кнопок: быстрые переходы, API-вызовы и отправка сообщений во внешние каналы. При наведении на карточки и элементы формы показываются пояснения, что именно делает каждая настройка.">
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
            <Text type="secondary">
              Каталог операционных действий с описанием, иконкой, безопасным запуском и историей.
            </Text>
          </div>
          {canWrite ? (
            <Tooltip title="Создать новую кнопку-инструмент с описанием, иконкой и сценарием запуска.">
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
                Добавить инструмент
              </Button>
            </Tooltip>
          ) : null}
        </Space>
      </Card>

      <Card loading={loading}>
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
      </Card>

      <Modal
        title={editingTool ? 'Редактировать инструмент' : 'Новый инструмент'}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          setEditingTool(null);
          setIconFileList([]);
        }}
        onOk={handleSave}
        okText={editingTool ? 'Сохранить' : 'Создать'}
        cancelText="Отмена"
        confirmLoading={saving}
        width={820}
        destroyOnClose
      >
        <Form form={toolForm} layout="vertical" initialValues={DEFAULT_FORM_VALUES}>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="title"
                label={renderInfoLabel('Название', 'Короткое понятное имя кнопки. Оно будет видно в каталоге и всплывающих подсказках.')}
                rules={[{ required: true, message: 'Введите название' }]}
              >
                <Input maxLength={60} placeholder="Например: Открыть регламент выплат" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="category" label={renderInfoLabel('Категория', 'Помогает группировать инструменты по назначению: Операции, Коммуникации, Интеграции и т.д.') }>
                <Input placeholder="Например: Коммуникации" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="description"
            label={renderInfoLabel('Описание', 'Пояснение, что делает кнопка, зачем она нужна и когда ее использовать. Этот текст показывается в карточке и подсказке по hover.')}
            rules={[{ required: true, message: 'Добавьте описание' }]}
          >
            <TextArea rows={3} maxLength={500} placeholder="Например: Открывает страницу внешнего ресурса для проверки статуса поставки." />
          </Form.Item>

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="actionType" label={renderInfoLabel('Тип действия', 'Определяет, что именно произойдет при запуске инструмента.') }>
                <Select
                  options={Object.entries(ACTION_META).map(([value, meta]) => ({ value, label: meta.label }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="iconSource" label={renderInfoLabel('Источник иконки', 'Можно использовать внешний URL или загрузить собственную картинку.') }>
                <Select
                  options={[
                    { value: 'external_url', label: 'URL изображения' },
                    { value: 'upload', label: 'Загрузить файл' },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>

          {currentIconSource === 'external_url' ? (
            <Form.Item name="iconUrl" label={renderInfoLabel('URL иконки', 'HTTP/HTTPS ссылка на картинку. Используется в карточке кнопки и в списке управления.') }>
              <Input placeholder="https://example.com/icon.png" />
            </Form.Item>
          ) : (
              <Form.Item label={renderInfoLabel('Файл иконки', 'Загрузите PNG, JPG, GIF, WebP или SVG до 3MB. Иконка поможет быстро различать инструменты визуально.') }>
              <Upload
                accept=".jpg,.jpeg,.png,.gif,.webp,.svg"
                beforeUpload={(file) => {
                  setIconFileList([file]);
                  return false;
                }}
                fileList={iconFileList}
                onRemove={() => setIconFileList([])}
                maxCount={1}
              >
                <Button icon={<UploadOutlined />}>Выбрать файл</Button>
              </Upload>
              {editingTool?.iconFilePath ? (
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary">Текущий файл: {editingTool.iconFilePath}</Text>
                </div>
              ) : null}
            </Form.Item>
          )}

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="sortOrder" label={renderInfoLabel('Порядок', 'Чем меньше число, тем выше инструмент будет отображаться в каталоге.') }>
                <InputNumber style={{ width: '100%' }} min={1} max={9999} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="isActive" label={renderInfoLabel('Активность', 'Неактивный инструмент сохраняется в системе, но не будет выполняться.') } valuePropName="checked">
                <Switch checkedChildren="Вкл" unCheckedChildren="Выкл" />
              </Form.Item>
            </Col>
          </Row>

          <Card size="small" title={renderInfoLabel('Параметры действия', 'Набор полей ниже меняется в зависимости от выбранного типа действия.')}>
            {currentActionType === 'open_url' ? (
              <Row gutter={16}>
                <Col xs={24} md={16}>
                  <Form.Item name="openUrl" label={renderInfoLabel('HTTP/HTTPS адрес', 'Адрес внешнего ресурса, который будет открыт по нажатию на кнопку.')} rules={[{ required: true, message: 'Введите URL' }] }>
                    <Input placeholder="https://example.com/resource" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="openMode" label={renderInfoLabel('Режим открытия', 'Открыть ссылку в новой вкладке или в текущей.') }>
                    <Select options={[{ value: 'new_tab', label: 'Новая вкладка' }, { value: 'same_tab', label: 'Текущая вкладка' }]} />
                  </Form.Item>
                </Col>
              </Row>
            ) : null}

            {currentActionType === 'rest_call' ? (
              <>
                <Row gutter={16}>
                  <Col xs={24} md={8}>
                    <Form.Item name="restMethod" label={renderInfoLabel('Метод', 'HTTP метод вызова API. Для операций изменения используйте POST/PUT/PATCH осознанно.') }>
                      <Select options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({ value, label: value }))} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={16}>
                    <Form.Item name="restUrl" label={renderInfoLabel('Endpoint URL', 'Полный URL endpoint, который будет вызван с backend-сервера.') } rules={[{ required: true, message: 'Введите URL endpoint' }]}>
                      <Input placeholder="https://api.example.com/v1/action" />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col xs={24} md={8}>
                    <Form.Item name="restTimeoutMs" label={renderInfoLabel('Таймаут, мс', 'Ограничение времени ожидания ответа внешнего API.') }>
                      <InputNumber style={{ width: '100%' }} min={1000} max={15000} step={500} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name="restAuthType" label={renderInfoLabel('Авторизация', 'Выберите способ авторизации для запроса. Можно сочетать Basic + API Key.') }>
                      <Select options={[
                        { value: 'none', label: 'Без авторизации' },
                        { value: 'basic', label: 'Basic Auth (логин/пароль)' },
                        { value: 'apiKey', label: 'API Key' },
                        { value: 'basic+apiKey', label: 'Basic + API Key' },
                      ]} />
                    </Form.Item>
                  </Col>
                  {['basic', 'basic+apiKey'].includes(currentAuthType) && (
                    <>
                      <Col xs={24} md={8}>
                        <Form.Item name="restBasicUser" label={renderInfoLabel('Basic user', 'Имя пользователя для Basic Auth.') }>
                          <Input placeholder="username" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name="restBasicPass" label={renderInfoLabel('Basic password', 'Пароль для Basic Auth.') }>
                          <Input.Password placeholder="password" />
                        </Form.Item>
                      </Col>
                    </>
                  )}
                  {['apiKey', 'basic+apiKey'].includes(currentAuthType) && (
                    <>
                      <Col xs={24} md={8}>
                        <Form.Item name="restApiKey" label={renderInfoLabel('API Key (имя)', 'Имя ключа для передачи в header или query.') }>
                          <Input placeholder="X-API-Key" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name="restApiKeyValue" label={renderInfoLabel('API Key (значение)', 'Значение ключа.') }>
                          <Input placeholder="секретный_ключ" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name="restApiKeyIn" label={renderInfoLabel('API Key в', 'Где передавать ключ: header или query.') }>
                          <Select options={[
                            { value: 'header', label: 'Заголовок' },
                            { value: 'query', label: 'Query-параметр' },
                          ]} />
                        </Form.Item>
                      </Col>
                    </>
                  )}
                </Row>
                <Form.Item name="restHeadersJson" label={renderInfoLabel('Headers JSON', 'Дополнительные HTTP заголовки в формате JSON объекта.') }>
                  <TextArea rows={4} />
                </Form.Item>
                <Form.Item name="restBodyTemplateJson" label={renderInfoLabel('Body template JSON', 'Шаблон тела запроса. Поддерживает переменные вида {{currentUser.username}} и {{tool.title}}.') }>
                  <TextArea rows={6} />
                </Form.Item>
              </>
            ) : null}

            {currentActionType === 'telegram_send' ? (
              <>
                <Row gutter={16}>
                  <Col xs={24} md={12}>
                    <Form.Item name="telegramBotTokenEnv" label={renderInfoLabel('Env токена бота', 'Имя переменной окружения backend, где хранится Telegram bot token.') } rules={[{ required: true, message: 'Введите имя env' }]}>
                      <Input placeholder="TELEGRAM_BOT_TOKEN" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="telegramChatId" label={renderInfoLabel('Chat ID', 'ID группы или канала Telegram, куда уйдет сообщение.') } rules={[{ required: true, message: 'Введите chat ID' }]}>
                      <Input placeholder="-1001234567890" />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col xs={24} md={8}>
                    <Form.Item name="telegramParseMode" label={renderInfoLabel('Parse mode', 'Режим форматирования Telegram сообщения.') }>
                      <Select options={[{ value: 'Markdown', label: 'Markdown' }, { value: 'HTML', label: 'HTML' }]} />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item name="telegramMessageTemplate" label={renderInfoLabel('Шаблон сообщения', 'Текст сообщения с поддержкой переменных текущего пользователя и инструмента.') } rules={[{ required: true, message: 'Введите шаблон сообщения' }]}>
                  <TextArea rows={4} />
                </Form.Item>
              </>
            ) : null}

            {currentActionType === 'discord_send' ? (
              <>
                <Row gutter={16}>
                  <Col xs={24} md={12}>
                    <Form.Item name="discordWebhookUrlEnv" label={renderInfoLabel('Env webhook URL', 'Имя переменной окружения backend, где лежит Discord webhook URL.') } rules={[{ required: true, message: 'Введите имя env' }]}>
                      <Input placeholder="DISCORD_TOOLS_WEBHOOK_URL" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="discordUsername" label={renderInfoLabel('Имя отправителя', 'Какое имя будет видно в сообщении Discord webhook.') }>
                      <Input placeholder="StarFinance Bot" />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item name="discordMessageTemplate" label={renderInfoLabel('Шаблон сообщения', 'Текст уведомления, который уйдет в выбранный Discord канал.') } rules={[{ required: true, message: 'Введите шаблон сообщения' }]}>
                  <TextArea rows={4} />
                </Form.Item>
              </>
            ) : null}
          </Card>
        </Form>
      </Modal>

      <DraggableResizableModal
        title={lastRunTitle ? `Результат API: ${lastRunTitle}` : 'Результат API'}
        open={resultModalOpen}
        onClose={() => setResultModalOpen(false)}
      >
        <Tabs
          size="small"
          style={{ minHeight: 540 }}
          items={[
            {
              key: 'answer',
              label: 'Ответ',
              children: <JsonTreeViewer data={lastRunResult} />,
            },
            {
              key: 'table',
              label: 'Таблица',
              children: <TableViewer data={lastRunResult} />,
            },
          ]}
        />
      </DraggableResizableModal>

    </div>
  );
}

export default Tools;
