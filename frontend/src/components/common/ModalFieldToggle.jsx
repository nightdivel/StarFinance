import React, { useMemo, useState } from 'react';
import { Modal, Checkbox, Button, Space, Typography } from 'antd';

const { Text } = Typography;

export default function ModalFieldToggle({
  open,
  onClose,
  fields = [],
  hidden = new Set(),
  onToggleField,
  label = 'Строки',
}) {
  const [localHidden, setLocalHidden] = useState(() => new Set(hidden));

  // Sync with parent hidden on open
  React.useEffect(() => {
    if (open) setLocalHidden(new Set(hidden));
  }, [open, hidden]);

  const handleToggle = (f) => {
    setLocalHidden((prev) => {
      const next = new Set(prev);
      next.has(f) ? next.delete(f) : next.add(f);
      return next;
    });
  };

  const handleApply = () => {
    // Diff and call onToggleField for each changed
    fields.forEach(f => {
      const wasHidden = hidden.has(f);
      const nowHidden = localHidden.has(f);
      if (wasHidden !== nowHidden) onToggleField(f);
    });
    onClose();
  };

  const visible = fields.filter(f => !localHidden.has(f)).length;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={handleApply}
      title={label}
      okText="Применить"
      cancelText="Отмена"
      width={340}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={2}>
        <Text type="secondary" style={{ marginBottom: 8, display: 'block' }}>
          Показано: {visible} из {fields.length}
        </Text>
        <div style={{ maxHeight: 320, overflowY: 'auto', minWidth: 160 }}>
          {fields.map(f => (
            <div key={f} style={{ padding: '3px 0' }}>
              <Checkbox
                checked={!localHidden.has(f)}
                onChange={() => handleToggle(f)}
              >
                <span style={{ fontSize: 12 }}>{String(f)}</span>
              </Checkbox>
            </div>
          ))}
        </div>
      </Space>
    </Modal>
  );
}
