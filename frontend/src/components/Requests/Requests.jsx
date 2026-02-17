import React, { useEffect, useState } from 'react';
import { Card, Table, Tag, Button, Space, Popconfirm, message, Input, Tooltip } from 'antd';
import TableWithFullscreen from '../common/TableWithFullscreen';
import { apiService } from '../../services/apiService';
import { authService } from '../../services/authService';
import { getSocket } from '../../lib/realtime/socket';

const Requests = () => {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [financeRows, setFinanceRows] = useState([]);
  const [reqSearch, setReqSearch] = useState('');
  const [frSearch, setFrSearch] = useState('');
  const me = authService.getCurrentUser();
  const currentUsername = me?.username;
  const isAdmin = authService.hasPermission('users', 'write') || (me?.accountType === 'Администратор');

  const formatServerDateTime = (isoLike) => {
    if (!isoLike) return '-';
    const d = new Date(isoLike);
    if (Number.isNaN(d.getTime())) return '-';
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'UTC',
    }).format(d);
  };

  // Finance requests actions
  const confirmFinanceReq = async (rec) => {
    try {
      await apiService.confirmFinanceRequest(rec.id);
      message.success('Заявка по транзакции подтверждена');
      load();
    } catch {
      message.error('Не удалось подтвердить заявку по транзакции');
    }
  };
  const cancelFinanceReq = async (rec) => {
    try {
      await apiService.cancelFinanceRequest(rec.id);
      message.success('Заявка по транзакции отменена');
      load();
    } catch {
      message.error('Не удалось отменить заявку по транзакции');
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const r = await apiService.getRelatedRequests();
      const arr = Array.isArray(r) ? r : [];
      // Backend: id, warehouse_item_id, quantity, status, created_at, buyer_user_id, buyer_username, name, cost, currency, owner_login
      setRows(arr.map((x) => ({
        id: x.id,
        itemName: x.name,
        quantity: Number(x.quantity) || 0,
        buyerUsername: x.buyer_username || '',
        ownerLogin: x.owner_login || '',
        status: x.status,
        createdAt: x.created_at,
        currency: x.currency || '',
        pricePerUnit: x.cost != null ? Number(x.cost) : null,
      })));

      // Finance requests: fr.id, transaction_id, from_user, to_user, status, created_at, amount, currency
      const fr = await apiService.getRelatedFinanceRequests();
      const farr = Array.isArray(fr) ? fr : [];
      setFinanceRows(farr);
    } catch (e) {
      message.error('Ошибка загрузки заявок');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const s = getSocket();
    const onChange = () => load();
    s.on('requests:changed', onChange);
    s.on('finance_requests:changed', onChange);
    return () => {
      s.off('requests:changed', onChange);
      s.off('finance_requests:changed', onChange);
    };
  }, []);

  const canWrite = authService.hasPermission('requests', 'write');
  const isPending = (s) => ['В обработке','Заявка отправлена'].includes(String(s || '').trim());
  const statusTag = (s) => {
    const status = String(s || '').trim();
    if (status === 'В обработке' || status === 'Заявка отправлена') return <Tag color="gold">{status}</Tag>;
    if (status === 'Выполнено') return <Tag color="green">{status}</Tag>;
    if (status === 'Отменена') return <Tag color="red">{status}</Tag>;
    return <Tag>{status || '-'}</Tag>;
  };

  const confirmReq = async (rec) => {
    try {
      await apiService.confirmRequest(rec.id);
      message.success('Заявка подтверждена');
      load();
    } catch {
      message.error('Не удалось подтвердить заявку');
    }
  };

  const cancelReq = async (rec) => {
    try {
      await apiService.cancelRequest(rec.id);
      message.success('Заявка отменена');
      load();
    } catch {
      message.error('Не удалось отменить заявку');
    }
  };

  const deleteReq = async (rec) => {
    try {
      await apiService.deleteRequest(rec.id);
      message.success('Заявка удалена');
      load();
    } catch {
      message.error('Не удалось удалить заявку');
    }
  };

  const columns = [
    {
      title: 'Товар',
      dataIndex: 'itemName',
      key: 'itemName',
      width: 240,
      ellipsis: true,
      onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
      render: (text) => (
        <Tooltip title={text}>
          <span className="inline-block max-w-full whitespace-nowrap overflow-hidden text-ellipsis">
            {text}
          </span>
        </Tooltip>
      ),
    },
    { title: 'Кол-во', dataIndex: 'quantity', key: 'quantity', width: 100, align: 'right' },
    { title: 'Покупатель', dataIndex: 'buyerUsername', key: 'buyerUsername', width: 160 },
    { title: 'Продавец', dataIndex: 'ownerLogin', key: 'ownerLogin', width: 160 },
    {
      title: 'Время (сервер)', key: 'createdAt', width: 180, align: 'center',
      render: (_, rec) => formatServerDateTime(rec.createdAt),
      sorter: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    },
    { title: 'Статус', dataIndex: 'status', key: 'status', width: 160, render: statusTag },
    {
      title: 'Действия', key: 'actions', width: 260, fixed: 'right',
      render: (_, rec) => {
        const isOwner = rec.ownerLogin && currentUsername && rec.ownerLogin === currentUsername;
        const isBuyer = rec.buyerUsername && currentUsername && rec.buyerUsername === currentUsername;
        const canConfirm = (isAdmin || isOwner) && isPending(rec.status);
        const canCancel = (isAdmin || isBuyer) && isPending(rec.status);
        const canDelete = isAdmin || !isPending(rec.status);
        return (
          <Space>
            <Button type="primary" size="small" disabled={!canConfirm} onClick={() => confirmReq(rec)}>Подтвердить</Button>
            <Button size="small" danger disabled={!canCancel} onClick={() => cancelReq(rec)}>Отменить</Button>
            <Popconfirm title="Удалить заявку?" okText="Удалить" cancelText="Отмена" onConfirm={() => deleteReq(rec)}>
              <Button size="small" disabled={!canDelete}>Удалить</Button>
            </Popconfirm>
          </Space>
        );
      }
    }
  ];

  const financeColumns = [
    { title: 'Дата', key: 'created_at', width: 180, align: 'center', render: (_, r) => formatServerDateTime(r.created_at) },
    { title: 'Отправитель', key: 'from_username', width: 160, render: (_, r) => r?.from_username || '-' },
    { title: 'Получатель', key: 'to_username', width: 160, render: (_, r) => r?.to_username || '-' },
    { title: 'Сумма', key: 'amount', width: 140, align: 'right', render: (_, r) => `${Number(r.amount || 0).toFixed(2)} ${r.currency || ''}` },
    { title: 'Статус', dataIndex: 'status', key: 'status', width: 140, render: statusTag },
    {
      title: 'Действия', key: 'actions', width: 260, fixed: 'right',
      render: (_, rec) => {
        const meU = String(me?.username || '').toLowerCase();
        const recToU = String(rec?.to_username || '').toLowerCase();
        const isRecipient = !!meU && recToU === meU;
        const canConfirm = isRecipient && rec.status === 'В обработке';
        const canCancel = isRecipient && rec.status === 'В обработке';
        return (
          <Space>
            <Button type="primary" size="small" disabled={!canConfirm} onClick={() => confirmFinanceReq(rec)}>Подтвердить</Button>
            <Button size="small" danger disabled={!canCancel} onClick={() => cancelFinanceReq(rec)}>Отменить</Button>
          </Space>
        );
      }
    }
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card title="Заявки на покупку (витрина)" extra={
        <Input
          allowClear
          placeholder="Поиск по всем полям"
          value={reqSearch}
          onChange={(e) => setReqSearch(e.target.value)}
          className="w-[260px]"
        />
      }>
        <TableWithFullscreen
          tableProps={{
            columns,
            dataSource: rows.filter((r) => {
              const q = String(reqSearch || '').toLowerCase();
              if (!q) return true;
              const vals = [
                r.id,
                r.itemName,
                r.buyerUsername,
                r.ownerLogin,
                r.quantity != null ? String(r.quantity) : '',
                r.pricePerUnit != null ? String(r.pricePerUnit) : '',
                r.currency,
                r.status,
                r.createdAt,
              ];
              return vals.some((v) => String(v || '').toLowerCase().includes(q));
            }),
            rowKey: 'id',
            loading,
            pagination: { pageSize: 20 },
            scroll: { x: '100%' },
          }}
        />
      </Card>
      <Card title="Финансовые заявки" extra={
        <Input
          allowClear
          placeholder="Поиск по всем полям"
          value={frSearch}
          onChange={(e) => setFrSearch(e.target.value)}
          className="w-[260px]"
        />
      }>
        <TableWithFullscreen
          tableProps={{
            columns: financeColumns,
            dataSource: financeRows.filter((r) => {
              const q = String(frSearch || '').toLowerCase();
              if (!q) return true;
              const vals = [
                r.id,
                r.transaction_id,
                r.from_user,
                r.from_username,
                r.to_user,
                r.to_username,
                r.amount != null ? String(r.amount) : '',
                r.currency,
                r.status,
                r.type,
                r.created_at,
              ];
              return vals.some((v) => String(v || '').toLowerCase().includes(q));
            }),
            rowKey: 'id',
            loading,
            pagination: { pageSize: 20 },
            scroll: { x: '100%' },
          }}
        />
      </Card>
    </div>
  );
};

export default Requests;
