import React, { useEffect, useState, useMemo } from 'react';
import {
  Card,
  Button,
  Modal,
  Form,
  Input,
  DatePicker,
  Upload,
  message,
  Breadcrumb,
  Avatar,
  Tooltip,
  Pagination,
  Empty,
  Spin,
  Popconfirm,
  Tag,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  UserOutlined,
  CalendarOutlined,
  ClearOutlined,
  FileImageOutlined,
} from '@ant-design/icons';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { newsService } from '../../services/newsService';
import { authService } from '../../services/authService';
import { formatServerDate } from '../../utils/helpers';

const { TextArea } = Input;
const { RangePicker } = DatePicker;

const News = ({ userData }) => {
  const [newsList, setNewsList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingNews, setEditingNews] = useState(null);
  const [selectedNews, setSelectedNews] = useState(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [readUsers, setReadUsers] = useState([]);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0,
  });

  const [newsForm] = Form.useForm();
  const isAdmin = authService.hasPermission('news', 'write') || userData?.accountType === 'Администратор';

  // Модули для React Quill
  const quillModules = {
    toolbar: [
      [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      ['blockquote', 'code-block'],
      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
      [{ 'script': 'sub'}, { 'script': 'super' }],
      [{ 'indent': '-1'}, { 'indent': '+1' }],
      [{ 'direction': 'rtl' }],
      [{ 'color': [] }, { 'background': [] }],
      [{ 'font': [] }],
      [{ 'align': [] }],
      ['link', 'image', 'video'],
      ['clean']
    ],
  };

  // Форматы для React Quill
  const quillFormats = [
    'header', 'bold', 'italic', 'underline', 'strike', 'blockquote',
    'list', 'bullet', 'indent', 'script', 'align', 'direction',
    'color', 'background', 'font', 'link', 'image', 'video', 'code-block'
  ];

  // Загрузка новостей
  const loadNews = async (page = 1) => {
    setLoading(true);
    try {
      const response = await newsService.getNews(page, pagination.pageSize);
      setNewsList(response.data || []);
      setPagination(prev => ({
        ...prev,
        current: page,
        total: response.total || 0,
      }));
    } catch (error) {
      message.error('Ошибка загрузки новостей');
      console.error('Load news error:', error);
    } finally {
      setLoading(false);
    }
  };

  // Загрузка пользователей, ознакомившихся с новостью
  const loadReadUsers = async (newsId) => {
    try {
      const response = await newsService.getReadUsers(newsId);
      setReadUsers(response.data || []);
    } catch (error) {
      console.error('Load read users error:', error);
    }
  };

  // Создание/обновление новости
  const saveNews = async (values) => {
    try {
      const newsData = {
        title: values.title,
        content: values.content,
        summary: values.summary,
        publishedAt: values.publishedAt?.toISOString(),
      };

      if (editingNews) {
        await newsService.updateNews(editingNews.id, newsData);
        message.success('Новость обновлена');
      } else {
        await newsService.createNews(newsData);
        message.success('Новость создана');
      }

      setModalVisible(false);
      setEditingNews(null);
      newsForm.resetFields();
      loadNews(pagination.current);
    } catch (error) {
      message.error(editingNews ? 'Ошибка обновления новости' : 'Ошибка создания новости');
      console.error('Save news error:', error);
    }
  };

  // Удаление новости
  const deleteNews = async (id) => {
    try {
      await newsService.deleteNews(id);
      message.success('Новость удалена');
      loadNews(pagination.current);
    } catch (error) {
      message.error('Ошибка удаления новости');
      console.error('Delete news error:', error);
    }
  };

  // Отметить новость как прочитанную
  const markAsRead = async (newsId) => {
    try {
      await newsService.markAsRead(newsId);
      // Обновляем локальный список
      setNewsList(prev => prev.map(news => 
        news.id === newsId 
          ? { ...news, isRead: true, readCount: (news.readCount || 0) + 1 }
          : news
      ));
    } catch (error) {
      console.error('Mark as read error:', error);
    }
  };

  // Очистить список ознакомившихся
  const clearReadUsers = async (newsId) => {
    try {
      await newsService.clearReadUsers(newsId);
      message.success('Список ознакомившихся очищен');
      loadReadUsers(newsId);
      loadNews(pagination.current);
    } catch (error) {
      message.error('Ошибка очистки списка');
      console.error('Clear read users error:', error);
    }
  };

  // Открытие модального окна редактирования
  const openEditModal = (news = null) => {
    setEditingNews(news);
    if (news) {
      newsForm.setFieldsValue({
        title: news.title,
        content: news.content,
        summary: news.summary,
        publishedAt: news.publishedAt ? new Date(news.publishedAt) : null,
      });
    } else {
      newsForm.resetFields();
    }
    setModalVisible(true);
  };

  // Открытие детального просмотра новости
  const openNewsDetail = async (news) => {
    setSelectedNews(news);
    setDetailModalVisible(true);
    await loadReadUsers(news.id);
    
    // Отмечаем новость как прочитанную
    if (!news.isRead) {
      markAsRead(news.id);
    }
  };

  // Обработка пагинации
  const handlePageChange = (page, pageSize) => {
    setPagination(prev => ({ ...prev, current: page, pageSize }));
    loadNews(page);
  };

  // Загрузка изображений
  const handleImageUpload = async (file) => {
    try {
      const response = await newsService.uploadImage(file);
      return response.url;
    } catch (error) {
      message.error('Ошибка загрузки изображения');
      throw error;
    }
  };

  useEffect(() => {
    loadNews();
  }, []);

  return (
    <div className="p-3">
      {/* Заголовок с кнопкой добавления */}
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="mb-0">Новости</h2>
        {isAdmin && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => openEditModal()}
          >
            Добавить новость
          </Button>
        )}
      </div>

      {/* Список новостей */}
      <div className="row">
        {loading ? (
          <div className="col-12 text-center py-5">
            <Spin size="large" />
          </div>
        ) : newsList.length === 0 ? (
          <div className="col-12">
            <Empty description="Новостей нет" />
          </div>
        ) : (
          newsList.map((news) => (
            <div key={news.id} className="col-lg-6 col-xl-4 mb-3">
              <Card
                hoverable
                className="h-100"
                actions={[
                  <Tooltip title="Подробнее">
                    <EyeOutlined onClick={() => openNewsDetail(news)} />
                  </Tooltip>,
                  ...(isAdmin ? [
                    <Tooltip title="Редактировать">
                      <EditOutlined onClick={() => openEditModal(news)} />
                    </Tooltip>,
                    <Tooltip title="Удалить">
                      <Popconfirm
                        title="Удалить новость?"
                        onConfirm={() => deleteNews(news.id)}
                        okText="Да"
                        cancelText="Нет"
                      >
                        <DeleteOutlined />
                      </Popconfirm>
                    </Tooltip>,
                  ] : []),
                ]}
              >
                <div className="d-flex justify-content-between align-items-start mb-2">
                  <h5 className="mb-1">{news.title}</h5>
                  {!news.isRead && (
                    <Tag color="green">Новая</Tag>
                  )}
                </div>
                
                <p className="text-muted mb-2">{news.summary}</p>
                
                <div className="d-flex justify-content-between align-items-center text-muted small">
                  <span>
                    <CalendarOutlined /> {formatServerDate(news.publishedAt)}
                  </span>
                  <span>
                    <EyeOutlined /> {news.readCount || 0}
                  </span>
                </div>
              </Card>
            </div>
          ))
        )}
      </div>

      {/* Пагинация */}
      {newsList.length > 0 && (
        <div className="d-flex justify-content-center mt-4">
          <Pagination
            current={pagination.current}
            pageSize={pagination.pageSize}
            total={pagination.total}
            onChange={handlePageChange}
            showSizeChanger
            showQuickJumper
            showTotal={(total, range) => `${range[0]}-${range[1]} из ${total} новостей`}
          />
        </div>
      )}

      {/* Модальное окно создания/редактирования новости */}
      <Modal
        title={editingNews ? 'Редактировать новость' : 'Добавить новость'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingNews(null);
          newsForm.resetFields();
        }}
        footer={null}
        width={1000}
      >
        <Form form={newsForm} layout="vertical" onFinish={saveNews}>
          <Form.Item
            name="title"
            label="Заголовок"
            rules={[{ required: true, message: 'Введите заголовок новости' }]}
          >
            <Input placeholder="Заголовок новости" />
          </Form.Item>

          <Form.Item
            name="summary"
            label="Краткое описание"
            rules={[{ required: true, message: 'Введите краткое описание' }]}
          >
            <TextArea rows={3} placeholder="Краткое описание новости" />
          </Form.Item>

          <Form.Item
            name="publishedAt"
            label="Дата публикации"
            rules={[{ required: true, message: 'Выберите дату публикации' }]}
          >
            <DatePicker 
              showTime 
              placeholder="Дата и время публикации"
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Form.Item
            name="content"
            label="Содержание"
            rules={[{ required: true, message: 'Введите содержание новости' }]}
          >
            <ReactQuill
              theme="snow"
              modules={quillModules}
              formats={quillFormats}
              placeholder="Введите содержание новости..."
              style={{ height: '300px', marginBottom: '50px' }}
            />
          </Form.Item>

          <Form.Item className="mt-4">
            <Button type="primary" htmlType="submit" className="mr-2">
              {editingNews ? 'Сохранить' : 'Создать'}
            </Button>
            <Button onClick={() => {
              setModalVisible(false);
              setEditingNews(null);
              newsForm.resetFields();
            }}>
              Отмена
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      {/* Модальное окно детального просмотра новости */}
      <Modal
        title={selectedNews?.title}
        open={detailModalVisible}
        onCancel={() => {
          setDetailModalVisible(false);
          setSelectedNews(null);
          setReadUsers([]);
        }}
        footer={[
          <Button key="close" onClick={() => setDetailModalVisible(false)}>
            Закрыть
          </Button>,
          ...(isAdmin && selectedNews ? [
            <Button
              key="clear"
              icon={<ClearOutlined />}
              onClick={() => clearReadUsers(selectedNews.id)}
            >
              Очистить список
            </Button>,
          ] : []),
        ]}
        width={900}
      >
        {selectedNews && (
          <div>
            {/* Хлебные крошки со списком ознакомившихся */}
            <div className="mb-3 p-3 bg-light rounded">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h6 className="mb-0">Ознакомились ({readUsers.length}):</h6>
                {isAdmin && readUsers.length > 0 && (
                  <Popconfirm
                    title="Очистить список ознакомившихся?"
                    onConfirm={() => clearReadUsers(selectedNews.id)}
                    okText="Да"
                    cancelText="Нет"
                  >
                    <Button size="small" icon={<ClearOutlined />}>
                      Очистить
                    </Button>
                  </Popconfirm>
                )}
              </div>
              
              {readUsers.length === 0 ? (
                <p className="text-muted mb-0">Никто еще не ознакомился с этой новостью</p>
              ) : (
                <div className="d-flex flex-wrap gap-2">
                  {readUsers.map((user) => (
                    <Tooltip key={user.id} title={`Ознакомился: ${formatServerDate(user.readAt)}`}>
                      <div className="d-flex align-items-center gap-1">
                        <Avatar size="small" icon={<UserOutlined />} src={user.avatar} />
                        <span>{user.username}</span>
                      </div>
                    </Tooltip>
                  ))}
                </div>
              )}
            </div>

            {/* Содержание новости */}
            <div className="mb-3">
              <p className="text-muted">{selectedNews.summary}</p>
              <div 
                dangerouslySetInnerHTML={{ __html: selectedNews.content }}
                className="news-content"
              />
            </div>

            <div className="text-muted small">
              <CalendarOutlined /> {formatServerDate(selectedNews.publishedAt)}
            </div>
          </div>
        )}
      </Modal>

      <style jsx>{`
        .news-content {
          line-height: 1.6;
        }
        .news-content img {
          max-width: 100%;
          height: auto;
        }
        .news-content h1, .news-content h2, .news-content h3 {
          margin-top: 1rem;
          margin-bottom: 0.5rem;
        }
      `}</style>
    </div>
  );
};

export default News;
