import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Button, Modal, Input, Space, Radio } from 'antd';
import { Table } from 'antd';
import { ExpandAltOutlined, CompressOutlined, FilterOutlined } from '@ant-design/icons';

const isEmptyFilter = (value) => {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return String(value).trim() === '';
};

const getValueByDataIndex = (record, dataIndex, fallbackKey) => {
  if (Array.isArray(dataIndex)) {
    return dataIndex.reduce((acc, key) => (acc == null ? undefined : acc[key]), record);
  }
  if (typeof dataIndex === 'string' && dataIndex.length > 0) {
    return record?.[dataIndex];
  }
  if (typeof fallbackKey === 'string' && fallbackKey.length > 0) {
    return record?.[fallbackKey];
  }
  return undefined;
};

const getColumnFilterKey = (col) => {
  if (col.key != null) return String(col.key);
  if (Array.isArray(col.dataIndex)) return col.dataIndex.join('.');
  if (typeof col.dataIndex === 'string') return col.dataIndex;
  return null;
};

const collectFilterableColumns = (columns = []) => {
  const acc = [];
  columns.forEach((col) => {
    if (!col || typeof col !== 'object') return;
    if (Array.isArray(col.children) && col.children.length > 0) {
      acc.push(...collectFilterableColumns(col.children));
      return;
    }
    const key = getColumnFilterKey(col);
    if (!key) return;
    if (Array.isArray(col.filters) || typeof col.filterDropdown === 'function' || typeof col.onFilter === 'function') {
      acc.push({ key, col });
    }
  });
  return acc;
};

const stripBuiltInFilterProps = (columns = []) =>
  columns.map((col) => {
    if (!col || typeof col !== 'object') return col;
    const next = { ...col };
    if (Array.isArray(next.children) && next.children.length > 0) {
      next.children = stripBuiltInFilterProps(next.children);
    }
    delete next.filters;
    delete next.filterDropdown;
    delete next.filterIcon;
    delete next.onFilter;
    delete next.filteredValue;
    delete next.defaultFilteredValue;
    return next;
  });

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
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState({});
  const [appliedFilters, setAppliedFilters] = useState({});
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

  const sourceColumns = normalizedColumns ?? tableProps?.columns ?? [];

  const filterableColumns = useMemo(
    () => collectFilterableColumns(sourceColumns),
    [sourceColumns]
  );

  const displayColumns = useMemo(
    () => stripBuiltInFilterProps(sourceColumns),
    [sourceColumns]
  );

  const filteredData = useMemo(() => {
    if (filterableColumns.length === 0) return fullData;

    return fullData.filter((record) => {
      for (const { key, col } of filterableColumns) {
        const rawFilterValue = appliedFilters[key];
        if (isEmptyFilter(rawFilterValue)) continue;

        if (typeof col.onFilter === 'function') {
          if (!col.onFilter(rawFilterValue, record)) return false;
          continue;
        }

        const sourceValue = getValueByDataIndex(record, col.dataIndex, key);
        const haystack = String(sourceValue ?? '').toLowerCase();
        const needle = String(rawFilterValue).toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [fullData, filterableColumns, appliedFilters]);

  const slicedData = useMemo(
    () => (infinite ? filteredData.slice(0, limit) : filteredData),
    [filteredData, infinite, limit]
  );

  const activeFiltersCount = useMemo(
    () => Object.values(appliedFilters).filter((v) => !isEmptyFilter(v)).length,
    [appliedFilters]
  );

  useEffect(() => {
    setLimit(batchSize);
  }, [filteredData, batchSize]);

  useEffect(() => {
    if (!infinite) return;
    const node = sentinelRef.current;
    if (!node) return;

    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          setLimit((prev) => (prev < filteredData.length ? Math.min(prev + batchSize, filteredData.length) : prev));
        }
      });
    });

    io.observe(node);
    return () => io.disconnect();
  }, [infinite, filteredData.length, batchSize]);

  const openFilters = () => {
    setDraftFilters(appliedFilters);
    setFilterModalOpen(true);
  };

  const applyFilters = () => {
    setAppliedFilters(draftFilters);
    setFilterModalOpen(false);
  };

  const resetFilters = () => {
    setDraftFilters({});
    setAppliedFilters({});
  };

  const toolbar = (
    <div className="d-flex gap-2 align-items-center">
      {extra}
      {filterableColumns.length > 0 && (
        <Button
          size="small"
          icon={<FilterOutlined />}
          onClick={openFilters}
          type={activeFiltersCount > 0 ? 'primary' : 'default'}
        >
          {activeFiltersCount > 0 ? `Фильтры (${activeFiltersCount})` : 'Фильтры'}
        </Button>
      )}
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
        <div onMouseDown={(e) => e.stopPropagation()}>
          <Table
            {...{
              bordered: false,
              size: tableProps?.size ?? 'small',
              tableLayout: tableProps?.tableLayout ?? 'auto',
              sticky: tableProps?.sticky ?? false,
              scroll: tableProps?.scroll,
              pagination: false,
              getPopupContainer: () => document.body,
              ...tableProps,
              columns: displayColumns,
              dataSource: slicedData,
            }}
          />
          {infinite && <div ref={sentinelRef} className="h-px" />}
        </div>
      </Card>

      <Modal
        open={filterModalOpen}
        onCancel={() => setFilterModalOpen(false)}
        title="Фильтры таблицы"
        okText="Применить"
        cancelText="Закрыть"
        onOk={applyFilters}
        width={520}
        footer={(
          <Space>
            <Button onClick={resetFilters}>Сбросить</Button>
            <Button onClick={() => setFilterModalOpen(false)}>Закрыть</Button>
            <Button type="primary" onClick={applyFilters}>Применить</Button>
          </Space>
        )}
      >
        <div className="d-flex flex-column gap-3">
          {filterableColumns.map(({ key, col }) => {
            const label = typeof col.title === 'string' ? col.title : key;
            const options = Array.isArray(col.filters)
              ? col.filters.map((f) => {
                  if (f && typeof f === 'object') {
                    return { label: f.text ?? String(f.value ?? ''), value: f.value };
                  }
                  return { label: String(f), value: f };
                })
              : null;

            return (
              <div key={key} className="d-flex flex-column gap-1">
                <span style={{ fontWeight: 600 }}>{label}</span>
                {options ? (
                  <Radio.Group
                    value={draftFilters[key] || undefined}
                    onChange={(e) => setDraftFilters((prev) => ({ ...prev, [key]: e.target.value }))}
                  >
                    <Space direction="vertical" size="small">
                      {options.map((opt) => (
                        <Radio key={String(opt.value)} value={opt.value}>{opt.label}</Radio>
                      ))}
                    </Space>
                  </Radio.Group>
                ) : (
                  <Input
                    allowClear
                    placeholder={`Поиск: ${label}`}
                    value={draftFilters[key] || ''}
                    onChange={(e) => setDraftFilters((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                )}
              </div>
            );
          })}
          {filterableColumns.length === 0 && (
            <span style={{ opacity: 0.8 }}>Для этой таблицы нет настраиваемых фильтров.</span>
          )}
        </div>
      </Modal>

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
            columns: displayColumns,
            dataSource: slicedData,
          }}
        />
        {infinite && <div ref={sentinelRef} className="h-px" />}
      </Modal>
    </>
  );
};

export default TableWithFullscreen;
