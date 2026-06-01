import React from 'react';
import { colors, shadows, borderRadius, spacing, fontWeight } from '@inkweaver/ui';
import type { InputProps } from '@inkweaver/ui';

export const Input: React.FC<InputProps> = (props) => {
  const { value, onChange, placeholder, type = 'text', disabled, className = '', style = {} } = props;

  const inputStyles: React.CSSProperties = {
    width: '100%',
    padding: `${spacing.sm} ${spacing.md}`,
    fontSize: 14,
    fontWeight: fontWeight.normal,
    color: colors.text.primary,
    backgroundColor: colors.bg.primary,
    border: `1px solid ${colors.border.primary}`,
    borderRadius: borderRadius.md,
    outline: 'none',
    transition: 'all 0.2s ease',
    boxSizing: 'border-box',
    ':focus': {
      borderColor: colors.primary[500],
      boxShadow: `0 0 0 3px ${colors.primary[100]}`,
    },
    ...(disabled && {
      opacity: 0.5,
      cursor: 'not-allowed',
    }),
    ...style,
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  return (
    <input
      type={type}
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      style={inputStyles}
    />
  );
};
