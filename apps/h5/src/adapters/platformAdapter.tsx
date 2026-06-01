/**
 * H5 端平台适配器
 */

import React from 'react';
import type { ButtonProps, InputProps, CheckboxProps, CardProps } from '@inkweaver/ui';

// H5 端 Button 实现
const Button: React.FC<ButtonProps> = ({ variant = 'primary', onPress, disabled, children, className, style }) => {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className={`h5-button h5-button-${variant} ${className || ''}`}
      style={{
        padding: '12px 24px',
        borderRadius: '8px',
        border: 'none',
        fontSize: '16px',
        fontWeight: '500',
        cursor: disabled ? 'not-allowed' : 'pointer',
        backgroundColor: variant === 'primary' ? '#4a90e2' : '#f5f5f5',
        color: variant === 'primary' ? 'white' : '#333',
        ...style
      }}
    >
      {children}
    </button>
  );
};

// H5 端 Input 实现
const Input: React.FC<InputProps> = ({ value, onChange, placeholder, type = 'text', disabled, className, style, required, minLength }) => {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`h5-input ${className || ''}`}
      style={{
        width: '100%',
        padding: '14px',
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        fontSize: '16px',
        boxSizing: 'border-box',
        backgroundColor: disabled ? '#f5f5f5' : 'white',
        ...style
      }}
      required={required}
      minLength={minLength}
    />
  );
};

// H5 端 Checkbox 实现
const Checkbox: React.FC<CheckboxProps> = ({ checked, onChange, label, disabled, className, style }) => {
  return (
    <div className={`h5-checkbox-container ${className || ''}`} style={style}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        style={{
          marginRight: '8px',
          cursor: disabled ? 'not-allowed' : 'pointer'
        }}
      />
      {label && (
        <label
          style={{
            fontSize: '14px',
            color: '#666',
            cursor: disabled ? 'not-allowed' : 'pointer'
          }}
        >
          {label}
        </label>
      )}
    </div>
  );
};

// H5 端 Card 实现
const Card: React.FC<CardProps> = ({ children, className, style }) => {
  return (
    <div
      className={`h5-card ${className || ''}`}
      style={{
        ...style
      }}
    >
      {children}
    </div>
  );
};

// H5 端平台适配器
export const platformAdapter = {
  Button,
  Input,
  Checkbox,
  Card
};
