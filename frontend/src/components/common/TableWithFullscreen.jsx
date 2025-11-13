import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Button, Modal } from 'antd';
import { Table } from 'antd';
import { ExpandAltOutlined, CompressOutlined } from '@ant-design/icons';

const TableWithFullscreen = ({
  title,
  extra,
  tableProps,
  cardProps,
  infinite = true,
  batchSize = 50,
}) => {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(batchSize);
  const sentinelRef = useRef(null);

  const fullData = Array.isArray(tableProps?.dataSource) ? tableProps.dataSource : [];
  const slicedData = useMemo(() => (infinite ? fullData.slice(0, limit) : fullData), [fullData, infinite, limit]);

  useEffect(() => {
    // reset limit when datasource changes
    setLimit(batchSize);
  }, [fullData, batchSize]);

  useEffect(() => {
    if (!infinite) return;
    const node = sentinelRef.current;
    if (!node) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          setLimit((prev) => (prev < fullData.length ? Math.min(prev + batchSize, fullData.length) : prev));
        }
      });
    });
    io.observe(node);
    return () => io.disconnect();
  }, [infinite, fullData.length, batchSize]);

  const toolbar = (
    <div style={{ display: 'flex', gap: 8 }}>
      {extra}
      <Button
        type="primary"
        size="small"
        icon={open ? <CompressOutlined /> : <ExpandAltOutlined />}
        onClick={() => setOpen(true)}
      >
        Развернуть
      </Button>
    </div>
  );

  return (
    <>
      <Card
        title={title}
        extra={toolbar}
        {...{
          bodyStyle: { paddingTop: 8, ...(cardProps?.bodyStyle || {}) },
          style: { marginBottom: 0, ...(cardProps?.style || {}) },
          ...cardProps,
        }}
      >
        <Table
          {...{
            bordered: false,
            sticky: tableProps?.sticky ?? false,
            scroll: { x: '100%', ...(tableProps?.scroll || {}) },
            pagination: false,
            ...tableProps,
            dataSource: slicedData,
          }}
        />
        {infinite && (
          <div ref={sentinelRef} style={{ height: 1 }} />
        )}
      </Card>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width="100vw"
        style={{ top: 0, padding: 0 }}
        bodyStyle={{ height: 'calc(100vh - 55px)', padding: 12, overflow: 'auto' }}
        title={title}
      >
        <div style={{ marginBottom: 12, textAlign: 'right' }}>
          <Button type="primary" icon={<CompressOutlined />} onClick={() => setOpen(false)}>
            Свернуть
          </Button>
        </div>
        <Table
          {...{
            bordered: false,
            sticky: tableProps?.sticky ?? false,
            scroll: { y: 'calc(100vh - 140px)', x: '100%', ...(tableProps?.scroll || {}) },
            pagination: false,
            ...tableProps,
            dataSource: slicedData,
          }}
        />
        {infinite && (
          <div ref={sentinelRef} style={{ height: 1 }} />
        )}
      </Modal>
    </>
  );
}
;

export default TableWithFullscreen;
