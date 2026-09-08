import React from 'react';

import type { ButtonProps, InputProps, CheckboxProps, CardProps } from '@inkweaver/ui';

const Button: React.FC<ButtonProps> = ({ variant = 'primary', onPress, disabled, children, className, style }) => {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className={`web-button web-button-${variant} ${className || ''}`}
      style={{
        padding: '12px 24px',
        borderRadius: '8px',
        border: 'none',
        fontSize: '14px',
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        backgroundColor: variant === 'primary' ? '#3b82f6' : '#f1f5f9',
        color: variant === 'primary' ? 'white' : '#475569',
        transition: 'all 0.2s ease',
        ...style
      }}
    >
      {children}
    </button>
  );
};

const Input: React.FC<InputProps> = ({ value, onChange, placeholder, type = 'text', disabled, className, style, required, minLength }) => {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`web-input ${className || ''}`}
      style={{
        width: '100%',
        padding: '12px 16px',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        fontSize: '14px',
        boxSizing: 'border-box',
        backgroundColor: disabled ? '#f8fafc' : 'white',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
        ...style
      }}
      required={required}
      minLength={minLength}
    />
  );
};

const Checkbox: React.FC<CheckboxProps> = ({ checked, onChange, label, disabled, className, style }) => {
  return (
    <div className={`web-checkbox-container ${className || ''}`} style={style}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        style={{
          marginRight: '8px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          width: '18px',
          height: '18px'
        }}
      />
      {label && (
        <label
          style={{
            fontSize: '14px',
            color: '#64748b',
            cursor: disabled ? 'not-allowed' : 'pointer'
          }}
        >
          {label}
        </label>
      )}
    </div>
  );
};

const Card: React.FC<CardProps> = ({ children, className, style }) => {
  return (
    <div
      className={`web-card ${className || ''}`}
      style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
        ...style
      }}
    >
      {children}
    </div>
  );
};

export const platformAdapter = {
  Button,
  Input,
  Checkbox,
  Card
};
