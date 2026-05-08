import React, { useMemo } from 'react';
import { Tooltip } from 'antd';

/**
 * Tooltip that renders only when text overflows.
 * Uses mouseEnterDelay to prevent UI freeze on rapid hover.
 */
const EllipsisTooltip = ({ text, placement = 'topLeft', maxWidth = '100%', children, className, style }) => {
  const tooltipProps = useMemo(() => ({
    mouseEnterDelay: 0.5,
    mouseLeaveDelay: 0.1,
  }), []);

  if (!text) return children ? children : <span>-</span>;

  return (
    <Tooltip
      title={String(text)}
      placement={placement}
      overlayStyle={{ maxWidth: '400px' }}
      {...tooltipProps}
    >
      <span
        className={className}
        style={{
          display: 'block',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth,
          ...style,
        }}
      >
        {String(text)}
      </span>
    </Tooltip>
  );
};

export default EllipsisTooltip;
