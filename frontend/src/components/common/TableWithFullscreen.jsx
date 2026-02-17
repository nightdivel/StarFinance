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

  const {
    className: cardClassName,
    ...restCardProps
  } = (cardProps || {});

  const mergedCardClassName = [
    cardClassName,
    'mb-0',
    'sf-card-pt-2',
  ]
    .filter(Boolean)
    .join(' ');

  const fullData = Array.isArray(tableProps?.dataSource) ? tableProps.dataSource : [];
  const slicedData = useMemo(() => (infinite ? fullData.slice(0, limit) : fullData), [fullData, infinite, limit]);

  const normalizedColumns = useMemo(() => {
    const cols = Array.isArray(tableProps?.columns) ? tableProps.columns : undefined;
    if (!cols) return cols;
    if (tableProps?.compactColumns === false) return cols;

    const stripWidth = (arr) =>
      arr.map((c) => {
        if (!c || typeof c !== 'object') return c;
        const hasFixed = !!c.fixed;
        const hasChildren = Array.isArray(c.children) && c.children.length > 0;
        const next = {
          ...c,
          ...(hasChildren ? { children: stripWidth(c.children) } : null),
        };
        if (!hasFixed && Object.prototype.hasOwnProperty.call(next, 'width')) {
          const { width: _w, ...rest } = next;
          return rest;
        }
        return next;
      });

    return stripWidth(cols);
  }, [tableProps]);

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
    <div className="flex gap-2">
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
        className={mergedCardClassName}
        {...restCardProps}
      >
        <Table
          {...{
            bordered: false,
            size: tableProps?.size ?? 'small',
            tableLayout: tableProps?.tableLayout ?? 'auto',
            sticky: tableProps?.sticky ?? false,
            scroll: tableProps?.scroll,
            pagination: false,
            ...tableProps,
            columns: normalizedColumns ?? tableProps?.columns,
            dataSource: slicedData,
          }}
        />
        {infinite && (
          <div ref={sentinelRef} className="h-px" />
        )}
      </Card>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width="100vw"
        wrapClassName="sf-fullscreen-modal"
        title={title}
      >
        <div className="mb-3 text-right">
          <Button type="primary" icon={<CompressOutlined />} onClick={() => setOpen(false)}>
            Свернуть
          </Button>
        </div>
        <Table
          {...{
            bordered: false,
            size: tableProps?.size ?? 'small',
            tableLayout: tableProps?.tableLayout ?? 'auto',
            sticky: tableProps?.sticky ?? false,
            scroll: { y: 'calc(100vh - 140px)', ...(tableProps?.scroll || {}) },
            pagination: false,
            ...tableProps,
            columns: normalizedColumns ?? tableProps?.columns,
            dataSource: slicedData,
          }}
        />
        {infinite && (
          <div ref={sentinelRef} className="h-px" />
        )}
      </Modal>
    </>
  );
}
;

export default TableWithFullscreen;
