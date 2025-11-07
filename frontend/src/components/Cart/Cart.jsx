import React, { useEffect, useState } from 'react';
import { Card, Tag, message } from 'antd';
import TableWithFullscreen from '../common/TableWithFullscreen';
import { apiService } from '../../services/apiService';

const Cart = () => {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const r = await apiService.getRelatedRequests();
      // Backend returns: id, warehouse_item_id, quantity, status, created_at,
      // buyer_user_id, buyer_username, name, cost, currency, owner_login
      const arr = Array.isArray(r) ? r : [];
      setItems(arr.map((x) => ({
        id: x.id,
        itemName: x.name,
        quantity: Number(x.quantity) || 0,
        pricePerUnit: x.cost != null ? Number(x.cost) : null,
        currency: x.currency || '',
        status: x.status,
        createdAt: x.created_at,
        buyerUsername: x.buyer_username || '',
        ownerLogin: x.owner_login || '',
      })));
    } catch (e) {
      message.error('Ошибка загрузки корзины');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const statusTag = (s) => {
    const status = String(s || '').trim();
    if (status === 'В обработке' || status === 'Заявка отправлена') return <Tag color="gold">{status}</Tag>;
    if (status === 'Выполнено') return <Tag color="green">{status}</Tag>;
    if (status === 'Отменена') return <Tag color="red">{status}</Tag>;
    return <Tag>{status || '-'}</Tag>;
  };

  const columns = [
    { title: 'Товар', dataIndex: 'itemName', key: 'itemName', width: 240, ellipsis: true },
    { title: 'Кол-во', dataIndex: 'quantity', key: 'quantity', width: 100, align: 'right' },
    { title: 'Покупатель', dataIndex: 'buyerUsername', key: 'buyerUsername', width: 160, ellipsis: true },
    { title: 'Продавец', dataIndex: 'ownerLogin', key: 'ownerLogin', width: 160, ellipsis: true },
    {
      title: 'Цена за ед.', key: 'price', width: 160, align: 'right',
      render: (_, r) => r.pricePerUnit != null ? `${r.pricePerUnit.toFixed(2)} ${r.currency || ''}` : '-'
    },
    {
      title: 'Сумма', key: 'total', width: 180, align: 'right',
      render: (_, r) => {
        const total = (Number(r.pricePerUnit) || 0) * (Number(r.quantity) || 0);
        return `${total.toFixed(2)} ${r.currency || ''}`;
      }
    },
    { title: 'Статус', dataIndex: 'status', key: 'status', width: 160, render: statusTag },
  ];

  return (
    <Card title="Мои заявки (покупатель или продавец)">
      <TableWithFullscreen
        tableProps={{
          columns,
          dataSource: items,
          rowKey: 'id',
          loading,
          pagination: false,
        }}
      />
    </Card>
  );
};

export default Cart;
