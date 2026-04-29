import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
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
import { apiService } from '../../services/apiService';
import { authService } from '../../services/authService';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

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
    restAuthType: config.auth?.type === 'bearer_env' ? 'bearer_env' : 'none',
    restTokenEnv: config.auth?.tokenEnv || 'TOOLS_API_TOKEN',
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
    payload.config = {
      method: values.restMethod,
      url: values.restUrl,
      timeoutMs: values.restTimeoutMs,
      headers: safeParseJson(values.restHeadersJson, {}),
      auth:
        values.restAuthType === 'bearer_env'
          ? { type: 'bearer_env', tokenEnv: values.restTokenEnv }
          : {},
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
    <Tooltip title={meta.tooltip}>
      <Tag color={meta.color} icon={meta.icon}>
        {meta.label}
      </Tag>
    </Tooltip>
  );
}

function ToolCard({ tool, onRun, running }) {
  const tooltipBody = (
    <div>
      <div><strong>Что это:</strong> {tool.title}</div>
      <div><strong>Для чего:</strong> {tool.description || 'Описание не указано'}</div>
    </div>
  );

  return (
    <Tooltip title={tooltipBody} placement="topLeft">
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
          <Avatar shape="square" size={56} src={tool.iconUrl || tool.iconFilePath || undefined} icon={<ToolOutlined />} />
          <Text strong style={{ maxWidth: '100%', textAlign: 'center' }} ellipsis>
            {tool.title}
          </Text>
        </Space>
      </Button>
    </Tooltip>
  );
}

function Tools({ userData, onRefresh }) {
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

  useEffect(() => {
    loadTools();
    loadRuns();
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
                        avatar={<Avatar shape="square" src={tool.iconUrl || tool.iconFilePath || undefined} icon={<ToolOutlined />} />}
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
          <Table rowKey="id" loading={runsLoading} columns={runColumns} dataSource={runs} pagination={{ pageSize: 8 }} />
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
                    <Form.Item name="restAuthType" label={renderInfoLabel('Авторизация', 'Если endpoint требует bearer token, токен берется из переменной окружения backend-сервера.') }>
                      <Select options={[{ value: 'none', label: 'Без авторизации' }, { value: 'bearer_env', label: 'Bearer из env' }]} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name="restTokenEnv" label={renderInfoLabel('Имя env токена', 'Например TOOLS_API_TOKEN. Сам токен в UI не хранится.') }>
                      <Input placeholder="TOOLS_API_TOKEN" />
                    </Form.Item>
                  </Col>
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

      <Modal
        title={lastRunTitle ? `Результат API: ${lastRunTitle}` : 'Результат API'}
        open={resultModalOpen}
        onCancel={() => setResultModalOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setResultModalOpen(false)}>
            Закрыть
          </Button>,
        ]}
        width={760}
      >
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 420, overflow: 'auto' }}>
          {JSON.stringify(lastRunResult || {}, null, 2)}
        </pre>
      </Modal>

    </div>
  );
}

export default Tools;
