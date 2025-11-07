import React, { useEffect, useMemo } from 'react';
import { Card, Form, Input, Button, Typography, Divider, message, Row, Col, Tag } from 'antd';
import { UserOutlined, MailOutlined, LockOutlined, SaveOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

// Редактирование профиля текущего пользователя
// onUpdateUser: (updatedUser) => void — обновляет userData в App (и localStorage)
// data, onDataUpdate — для синхронизации email/username в таблице users (демо)
const Profile = ({ userData, onUpdateUser, data, onDataUpdate }) => {
  const [form] = Form.useForm();

  useEffect(() => {
    if (userData) {
      form.setFieldsValue({
        username: userData.username || '',
        email: userData.email || '',
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    }
  }, [userData, form]);

  const onFinish = async (values) => {
    try {
      // В оффлайн/демо режиме просто обновляем профиль локально
      const updatedUser = {
        ...userData,
        username: values.username,
        email: values.email || '',
      };

      // Здесь могла бы быть реальная смена пароля через API
      // if (values.currentPassword && values.newPassword) await api.changePassword(...)

      onUpdateUser(updatedUser);

      // Синхронизируем в demo-данных список users (если есть)
      if (data && onDataUpdate && Array.isArray(data.users)) {
        const idx = data.users.findIndex((u) => u.username === userData?.username);
        if (idx !== -1) {
          const newUsers = [...data.users];
          newUsers[idx] = {
            ...newUsers[idx],
            username: updatedUser.username,
            email: updatedUser.email,
          };
          await onDataUpdate({ ...data, users: newUsers });
        }
      }

      message.success('Профиль обновлён');
    } catch (e) {
      message.error('Не удалось обновить профиль');
    }
  };

  // Compute per-user balances across currencies from data.transactions
  const balances = useMemo(() => {
    const result = {};
    const currencies = data?.system?.currencies || [];
    currencies.forEach((c) => (result[c] = 0));
    const username = userData?.username;
    if (!username || !Array.isArray(data?.transactions)) return result;
    const me = (data?.users || []).find((u) => u.username === username);
    const meId = me?.id;
    for (const t of data.transactions) {
      if (!t || !t.currency) continue;
      const cur = t.currency;
      if (!(cur in result)) result[cur] = 0;
      // Credit recipient regardless of type, debit sender regardless of type
      if (t.to_user === username || t.to_user === meId) result[cur] += Number(t.amount) || 0;
      if (t.from_user === username || t.from_user === meId) result[cur] -= Number(t.amount) || 0;
    }
    return result;
  }, [data?.transactions, data?.system?.currencies, userData?.username]);

  const validatePasswords = (_, value) => {
    const newPass = form.getFieldValue('newPassword');
    if (!newPass) return Promise.resolve();
    if (newPass !== value) return Promise.reject(new Error('Пароли не совпадают'));
    return Promise.resolve();
  };

  return (
    <div style={{ padding: 8 }}>
      <Card>
        <div style={{ marginBottom: 16 }}>
          <Title level={3} style={{ margin: 0 }}>
            Настройки профиля
          </Title>
          <Text type="secondary">Изменение параметров вашей учётной записи</Text>
        </div>

        <Divider orientation="left">Баланс по валютам</Divider>
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          {(data?.system?.currencies || []).map((c) => (
            <Col key={c} xs={24} sm={12} md={8} lg={6}>
              <Card size="small" bordered>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text strong>{c}</Text>
                  <Tag color={balances[c] >= 0 ? 'green' : 'red'}>
                    {Number(balances[c] || 0).toFixed(2)} {c}
                  </Tag>
                </div>
              </Card>
            </Col>
          ))}
        </Row>

        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={{ username: userData?.username, email: userData?.email }}
        >
          <Form.Item
            name="username"
            label="Логин"
            rules={[
              { required: true, message: 'Введите логин' },
              { min: 3, message: 'Минимум 3 символа' },
            ]}
          >
            <Input prefix={<UserOutlined />} placeholder="Логин" />
          </Form.Item>

          <Form.Item
            name="email"
            label="Email"
            rules={[{ type: 'email', message: 'Неверный формат email' }]}
          >
            <Input prefix={<MailOutlined />} placeholder="email@example.com" />
          </Form.Item>

          <Divider>Смена пароля (необязательно)</Divider>

          <Form.Item name="currentPassword" label="Текущий пароль">
            <Input.Password prefix={<LockOutlined />} placeholder="Введите текущий пароль" />
          </Form.Item>
          <Form.Item name="newPassword" label="Новый пароль">
            <Input.Password prefix={<LockOutlined />} placeholder="Введите новый пароль" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="Подтверждение пароля"
            dependencies={['newPassword']}
            rules={[{ validator: validatePasswords }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Повторите новый пароль" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>
              Сохранить
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default Profile;
