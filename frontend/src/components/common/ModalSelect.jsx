import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, Space, Tag, Typography } from 'antd';
import { CheckOutlined } from '@ant-design/icons';

const { Text } = Typography;

function OptionStub() {
  return null;
}

function normalizeOption(option) {
  if (!option) return null;
  if (typeof option === 'string' || typeof option === 'number') {
    return { value: option, label: String(option) };
  }
  if (typeof option === 'object') {
    return {
      value: option.value,
      label: option.label != null ? option.label : String(option.value ?? ''),
      disabled: !!option.disabled,
    };
  }
  return null;
}

function normalizeFromChildren(children) {
  return React.Children.toArray(children)
    .map((child) => {
      if (!React.isValidElement(child)) return null;
      const value = child.props?.value;
      const label = child.props?.children;
      return {
        value,
        label: label != null ? label : String(value ?? ''),
        disabled: !!child.props?.disabled,
      };
    })
    .filter(Boolean);
}

function ModalSelect({
  value,
  onChange,
  options,
  children,
  mode,
  placeholder = 'Выберите значение',
  disabled = false,
  allowClear = false,
  showSearch = false,
  className,
  style,
  loading = false,
  filterOption,
  optionFilterProp,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draftMulti, setDraftMulti] = useState(Array.isArray(value) ? value : []);

  const normalizedOptions = useMemo(() => {
    if (Array.isArray(options) && options.length > 0) {
      return options.map(normalizeOption).filter(Boolean);
    }
    return normalizeFromChildren(children);
  }, [options, children]);

  const valueSet = useMemo(() => new Set(Array.isArray(value) ? value : []), [value]);
  const isMultiple = mode === 'multiple';

  useEffect(() => {
    if (open && isMultiple) {
      setDraftMulti(Array.isArray(value) ? value : []);
    }
  }, [open, isMultiple, value]);

  const selectedText = useMemo(() => {
    if (isMultiple) {
      const list = Array.isArray(value) ? value : [];
      if (!list.length) return placeholder;
      const labels = list
        .map((v) => normalizedOptions.find((o) => o.value === v)?.label ?? String(v))
        .filter(Boolean)
        .map((l) => String(l));
      return labels.join(', ');
    }
    if (value === undefined || value === null || value === '') return placeholder;
    const found = normalizedOptions.find((o) => o.value === value);
    return found?.label ?? String(value);
  }, [isMultiple, value, normalizedOptions, placeholder]);

  const filteredOptions = useMemo(() => {
    const q = String(search || '').toLowerCase().trim();
    if (!q) return normalizedOptions;

    if (typeof filterOption === 'function') {
      return normalizedOptions.filter((opt) => {
        const filterArg = {
          value: opt.value,
          label: String(opt.label),
          [optionFilterProp || 'label']: String(opt.label),
        };
        return filterOption(search, filterArg);
      });
    }

    return normalizedOptions.filter((opt) => {
      const label = String(opt.label || '').toLowerCase();
      const v = String(opt.value || '').toLowerCase();
      return label.includes(q) || v.includes(q);
    });
  }, [normalizedOptions, search, filterOption, optionFilterProp]);

  const toggleMulti = (optionValue) => {
    setDraftMulti((prev) => {
      const nextSet = new Set(prev || []);
      if (nextSet.has(optionValue)) nextSet.delete(optionValue);
      else nextSet.add(optionValue);
      return Array.from(nextSet);
    });
  };

  const applyMulti = () => {
    onChange?.(draftMulti);
    setOpen(false);
  };

  const clearValue = () => {
    onChange?.(isMultiple ? [] : undefined);
    setOpen(false);
  };

  return (
    <>
      <Button
        block
        className={className}
        style={{
          ...style,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          minHeight: 38,
          textAlign: 'left',
        }}
        disabled={disabled || loading}
        onClick={() => setOpen(true)}
      >
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedText}
        </span>
        <Space size={6}>
          {isMultiple && Array.isArray(value) && value.length > 0 ? (
            <Tag style={{ marginInlineEnd: 0 }}>{value.length}</Tag>
          ) : null}
          <Text type="secondary">Выбрать</Text>
        </Space>
      </Button>

      <Modal
        title="Выбор значения"
        open={open}
        onCancel={() => setOpen(false)}
        width={560}
        footer={[
          allowClear ? (
            <Button key="clear" onClick={clearValue}>
              Очистить
            </Button>
          ) : null,
          <Button key="cancel" onClick={() => setOpen(false)}>
            Отмена
          </Button>,
          isMultiple ? (
            <Button key="ok" type="primary" onClick={applyMulti}>
              Применить
            </Button>
          ) : null,
        ].filter(Boolean)}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          {showSearch ? (
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск"
              allowClear
            />
          ) : null}

          {filteredOptions.map((opt) => {
            const selected = isMultiple ? draftMulti.includes(opt.value) : value === opt.value;
            return (
              <Button
                key={String(opt.value)}
                block
                disabled={opt.disabled}
                type={selected ? 'primary' : 'default'}
                onClick={() => {
                  if (isMultiple) {
                    toggleMulti(opt.value);
                  } else {
                    onChange?.(opt.value);
                    setOpen(false);
                  }
                }}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 42 }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {opt.label}
                </span>
                {selected ? <CheckOutlined /> : null}
              </Button>
            );
          })}

          {!filteredOptions.length ? <Text type="secondary">Ничего не найдено</Text> : null}
        </Space>
      </Modal>
    </>
  );
}

ModalSelect.Option = OptionStub;

export default ModalSelect;
