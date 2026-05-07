import React, { useRef, useEffect } from 'react';
import { Input, Button, Space } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

/**
 * Кастомный filterDropdown для AntD таблицы — инлайн-панель поиска.
 *
 * Использование в column:
 *   filterDropdown: (props) => <ModalTableFilter {...props} placeholder="Поиск..." />,
 *   filterIcon: (filtered) => <SearchOutlined style={{ color: filtered ? '#1677ff' : undefined }} />,
 */
const ModalTableFilter = ({
  setSelectedKeys,
  selectedKeys,
  confirm,
  clearFilters,
  placeholder = 'Поиск...',
  visible,
}) => {
  const inputRef = useRef(null);

  useEffect(() => {
    if (visible) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible]);

  const handleSearch = () => {
    confirm();
  };

  const handleReset = () => {
    clearFilters?.();
    confirm();
  };

  return (
    <div style={{ padding: '10px 12px', minWidth: '220px' }}>
      <Input
        ref={inputRef}
        prefix={<SearchOutlined />}
        placeholder={placeholder}
        value={selectedKeys[0]}
        onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
        onPressEnter={handleSearch}
        allowClear
        style={{ marginBottom: 8, display: 'block' }}
      />
      <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
        <Button size="small" onClick={handleReset}>Сбросить</Button>
        <Button type="primary" size="small" icon={<SearchOutlined />} onClick={handleSearch}>
          Найти
        </Button>
      </Space>
    </div>
  );
};

export default ModalTableFilter;
