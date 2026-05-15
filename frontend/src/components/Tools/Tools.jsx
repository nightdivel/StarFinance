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
      useEffect(() => { loadTools(); loadRuns(); }, []);
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
      <Popover content={tooltip} trigger="click">
        <InfoCircleOutlined style={{ cursor: 'pointer' }} />
      </Popover>
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

function ModalValueSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Выберите значение',
  title = 'Выбор значения',
  disabled = false,
}) {
  const [open, setOpen] = useState(false);

  const normalizedOptions = useMemo(
    () => options.map((option) => (typeof option === 'string' ? { value: option, label: option } : option)),
    [options]
  );

  const selectedOption = useMemo(
    () => normalizedOptions.find((option) => option.value === value),
    [normalizedOptions, value]
  );

  return (
    <>
      <Button
        block
        disabled={disabled}
        onClick={() => setOpen(true)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', minHeight: 38 }}
      >
        <span
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'left',
          }}
        >
          {selectedOption?.label || placeholder}
        </span>
        <Text type="secondary" style={{ marginLeft: 8, flexShrink: 0 }}>Выбрать</Text>
      </Button>

      <Modal
        title={title}
        open={open}
        onCancel={() => setOpen(false)}
        footer={[
          <Button key="close" onClick={() => setOpen(false)}>
            Закрыть
          </Button>,
        ]}
        width={560}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          {normalizedOptions.map((option) => {
            const isSelected = option.value === value;
            return (
              <Button
                key={String(option.value)}
                block
                type={isSelected ? 'primary' : 'default'}
                onClick={() => {
                  onChange?.(option.value);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  minHeight: 42,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option.label}</span>
                {isSelected ? <CheckOutlined /> : null}
              </Button>
            );
          })}
        </Space>
      </Modal>
    </>
  );
}

function ToolCard({ tool, onRun, running }) {
  return (
    <Button
      type="default"
      block
      size="large"
      loading={running}
      disabled={!tool.isActive || running}
      onClick={() => onRun(tool)}
      className="sf-tool-card-btn"
      style={{ height: '100%', minHeight: 108, padding: 12, overflow: 'hidden', textAlign: 'left' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Avatar shape="square" size={54} src={resolveToolIconSrc(tool)} icon={<ToolOutlined />} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0, width: '100%', gap: 6 }}>
          <Space size={6} wrap={false} style={{ width: '100%' }}>
            <ToolActionBadge actionType={tool.actionType} />
            <Tag icon={<PlayCircleOutlined />} style={{ marginInlineEnd: 0 }}>
              Запуск
            </Tag>
          </Space>
          <Text
            strong
            style={{
              width: '100%',
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {tool.title}
          </Text>
          <Text
            type="secondary"
            style={{
              width: '100%',
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 12,
            }}
          >
            {tool.description || 'Описание не указано'}
          </Text>
        </div>
      </div>
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

  const executeRun = async (tool) => {
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

  const handleRun = (tool) => {
    const actionMeta = ACTION_META[tool.actionType] || ACTION_META.open_url;
    Modal.confirm({
      title: 'Подтвердите запуск инструмента',
      okText: 'Запустить',
      cancelText: 'Отмена',
      content: (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Text strong style={{ display: 'block' }}>{tool.title}</Text>
          <ToolActionBadge actionType={tool.actionType} />
          <Text type="secondary" style={{ display: 'block' }}>
            {tool.description || actionMeta.tooltip}
          </Text>
        </Space>
      ),
      onOk: () => executeRun(tool),
    });
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
        <span>{value || record.toolId}</span>
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
        <span>{value ? String(value).slice(0, 48) : '-'}</span>
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
                        <Button icon={<EditOutlined />} onClick={() => openEditModal(tool)}>
                            Изменить
                          </Button>,
                        <Button key="delete" danger icon={<DeleteOutlined />} onClick={() => handleDelete(tool)}>
                            Удалить
                          </Button>,
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
              <Button danger icon={<DeleteOutlined />} onClick={async () => {
                  try {
                    await apiService.deleteToolRuns();
                    message.success('История запусков очищена');
                    await loadRuns();
                  } catch (e) {
                    message.error('Ошибка при очистке истории');
                  }
                }} disabled={!canWrite}>Очистить историю</Button>
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
              <Popover content="Раздел для кастомных кнопок: быстрые переходы, API-вызовы и отправка сообщений во внешние каналы." trigger="click">
                <InfoCircleOutlined style={{ cursor: 'pointer' }} />
              </Popover>
            </Space>
            <Text type="secondary">
              Каталог операционных действий с описанием, иконкой, безопасным запуском и историей.
            </Text>
          </div>
          {canWrite ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
              Добавить инструмент
            </Button>
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
                <ModalValueSelect
                  title="Тип действия"
                  options={Object.entries(ACTION_META).map(([value, meta]) => ({ value, label: meta.label }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="iconSource" label={renderInfoLabel('Источник иконки', 'Можно использовать внешний URL или загрузить собственную картинку.') }>
                <ModalValueSelect
                  title="Источник иконки"
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
                    <ModalValueSelect
                      title="Режим открытия"
                      options={[{ value: 'new_tab', label: 'Новая вкладка' }, { value: 'same_tab', label: 'Текущая вкладка' }]}
                    />
                  </Form.Item>
                </Col>
              </Row>
            ) : null}

            {currentActionType === 'rest_call' ? (
              <>
                <Row gutter={16}>
                  <Col xs={24} md={8}>
                    <Form.Item name="restMethod" label={renderInfoLabel('Метод', 'HTTP метод вызова API. Для операций изменения используйте POST/PUT/PATCH осознанно.') }>
                      <ModalValueSelect
                        title="HTTP метод"
                        options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((methodValue) => ({ value: methodValue, label: methodValue }))}
                      />
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
                      <ModalValueSelect
                        title="Тип авторизации"
                        options={[
                        { value: 'none', label: 'Без авторизации' },
                        { value: 'basic', label: 'Basic Auth (логин/пароль)' },
                        { value: 'apiKey', label: 'API Key' },
                        { value: 'basic+apiKey', label: 'Basic + API Key' },
                      ]}
                      />
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
                          <ModalValueSelect
                            title="Передача API Key"
                            options={[
                            { value: 'header', label: 'Заголовок' },
                            { value: 'query', label: 'Query-параметр' },
                          ]}
                          />
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
                      <ModalValueSelect
                        title="Telegram parse mode"
                        options={[{ value: 'Markdown', label: 'Markdown' }, { value: 'HTML', label: 'HTML' }]}
                      />
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
