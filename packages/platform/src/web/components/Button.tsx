import React from 'react';
import { colors, shadows, borderRadius, spacing, fontWeight } from '@inkweaver/ui';
import type { ButtonProps } from '@inkweaver/ui';

export const Button: React.FC<ButtonProps> = (props) => {
  const { variant = 'primary', children, disabled, className = '', style = {} } = props;

  const baseStyles: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: `${spacing.sm} ${spacing.lg}`,
    borderRadius: borderRadius.md,
    fontSize: 14,
    fontWeight: fontWeight.medium,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: 'none',
    transition: 'all 0.25s ease',
    ...style,
  };

  const variantStyles: React.CSSProperties = {
    primary: {
      background: 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)',
      color: '#ffffff',
      boxShadow: shadows.md,
      ':hover': {
        transform: 'translateY(-1px)',
        boxShadow: shadows.lg,
      },
      ':active': {
        transform: 'translateY(0)',
      },
    },
    secondary: {
      background: colors.bg.secondary,
      color: colors.text.primary,
      border: `1px solid ${colors.border.primary}`,
      ':hover': {
        background: colors.bg.tertiary,
      },
    },
    outline: {
      background: 'transparent',
      color: colors.primary[600],
      border: `1px solid ${colors.primary[400]}`,
      ':hover': {
        background: colors.primary[50],
      },
    },
    ghost: {
      background: 'transparent',
      color: colors.text.secondary,
      ':hover': {
        background: colors.bg.tertiary,
      },
    },
    danger: {
      background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
      color: '#ffffff',
      ':hover': {
        transform: 'translateY(-1px)',
        boxShadow: shadows.md,
      },
    },
  }[variant];

  const disabledStyles: React.CSSProperties = disabled
    ? {
        opacity: 0.5,
        cursor: 'not-allowed',
        transform: 'none',
      }
    : {};

  return (
    <button
      className={className}
      style={{ ...baseStyles, ...variantStyles, ...disabledStyles }}
      disabled={disabled}
      onClick={props.onPress}
    >
      {children}
    </button>
  );
};
