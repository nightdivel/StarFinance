import React, { useRef, useEffect } from 'react';
import { Modal, Input, Button, Space } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

/**
 * Замена стандартного filterDropdown AntD таблицы на модальное окно поиска.
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
    <Modal
      open={visible}
      title={null}
      footer={null}
      closable={false}
      width={320}
      styles={{ body: { padding: '16px' } }}
      onCancel={handleReset}
    >
      <Input
        ref={inputRef}
        prefix={<SearchOutlined />}
        placeholder={placeholder}
        value={selectedKeys[0]}
        onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
        onPressEnter={handleSearch}
        allowClear
        size="large"
        style={{ marginBottom: 12 }}
      />
      <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
        <Button onClick={handleReset}>Сбросить</Button>
        <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
          Найти
        </Button>
      </Space>
    </Modal>
  );
};

export default ModalTableFilter;
