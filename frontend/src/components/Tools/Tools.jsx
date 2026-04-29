import React from 'react';
import { Card, Empty, Typography } from 'antd';
import { ToolOutlined } from '@ant-design/icons';

const { Title } = Typography;

function Tools({ userData, data, onDataUpdate, onRefresh }) {
  return (
    <div className="fade-in">
      <Card size="small" className="mb-3">
        <Title level={3}>
          <ToolOutlined /> Инструменты
        </Title>
      </Card>
      <Card>
        <Empty
          description="Раздел Инструменты находится в разработке"
          style={{ marginTop: '50px', marginBottom: '50px' }}
        />
      </Card>
    </div>
  );
}

export default Tools;
