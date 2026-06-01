import React from 'react';
import { colors, shadows, borderRadius } from '@inkweaver/ui';
import type { CardProps } from '@inkweaver/ui';

export const Card: React.FC<CardProps> = (props) => {
  const { children, className = '', style = {} } = props;

  const cardStyles: React.CSSProperties = {
    background: colors.bg.primary,
    borderRadius: borderRadius.lg,
    boxShadow: shadows.sm,
    overflow: 'hidden',
    transition: 'all 0.3s ease',
    ...style,
  };

  return (
    <div className={className} style={cardStyles}>
      {children}
    </div>
  );
};
