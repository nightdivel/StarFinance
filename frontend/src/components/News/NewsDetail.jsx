import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Card,
  Spin,
  Breadcrumb,
  Avatar,
  Tag,
  Divider,
  message,
} from 'antd';
import {
  CalendarOutlined,
  EyeOutlined,
  UserOutlined,
  HomeOutlined,
} from '@ant-design/icons';
import DOMPurify from 'dompurify';
import { newsService } from '../../services/newsService';
import { formatServerDate } from '../../utils/helpers';

const NewsDetail = () => {
  const { id } = useParams();
  const [news, setNews] = useState(null);
  const [loading, setLoading] = useState(true);
  const [readUsers, setReadUsers] = useState([]);

  useEffect(() => {
    const loadNews = async () => {
      try {
        setLoading(true);
        
        // Получаем ID из useParams
        let newsId = id;
        
        if (!newsId) {
          message.error('ID новости не указан');
          return;
        }
        
        // Загружаем новость
        const newsData = await newsService.getNewsById(newsId);
        setNews(newsData);
        
        // Отмечаем новость как прочитанную
        await newsService.markAsRead(newsId);
        
        // Загружаем список прочитавших
        const readData = await newsService.getReadUsers(newsId);
        setReadUsers(readData);
        
      } catch (error) {
        console.error('Error loading news:', error);
        message.error('Ошибка загрузки новости');
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      loadNews();
    }
  }, [id]);

  if (loading) {
    return (
      <div className="text-center py-5">
        <Spin size="large" />
      </div>
    );
  }

  if (!news) {
    return (
      <div className="text-center py-5">
        <h3>Новость не найдена</h3>
      </div>
    );
  }

  return (
    <div className="container-fluid py-4">
      {/* Хлебные крошки */}
      <Breadcrumb className="mb-4">
        <Breadcrumb.Item href="#/">
          <HomeOutlined /> Главная
        </Breadcrumb.Item>
        <Breadcrumb.Item href="#/news">
          Новости
        </Breadcrumb.Item>
        <Breadcrumb.Item>{news.title}</Breadcrumb.Item>
      </Breadcrumb>

      {/* Заголовок новости */}
      <Card className="mb-4">
        <div className="d-flex justify-content-between align-items-start mb-3">
          <h1 className="mb-0">{news.title}</h1>
          <Tag color="blue">
            <EyeOutlined /> {news.readCount || 0} просмотров
          </Tag>
        </div>
        
        <div className="d-flex align-items-center text-muted mb-3">
          <CalendarOutlined className="me-2" />
          <span>{formatServerDate(news.publishedAt)}</span>
        </div>
        
        <Divider />
        
        {/* Содержимое новости */}
        <div 
          className="news-content"
          dangerouslySetInnerHTML={{ 
            __html: DOMPurify.sanitize(news.content, {
              ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'ol', 'ul', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre', 'a', 'img'],
              ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'target'],
              ALLOW_DATA_ATTR: false
            })
          }}
        />
      </Card>

      {/* Список ознакомившихся */}
      {readUsers.length > 0 && (
        <Card title="Ознакомились с новостью" className="mb-4">
          <div className="d-flex flex-wrap gap-2">
            {readUsers.map((user) => (
              <div key={user.id} className="d-flex align-items-center">
                <Avatar 
                  size="small" 
                  src={user.avatarUrl} 
                  icon={<UserOutlined />}
                  className="me-2"
                />
                <span>{user.nickname || user.username}</span>
                <span className="text-muted ms-2">
                  {formatServerDate(user.readAt)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

export default NewsDetail;
