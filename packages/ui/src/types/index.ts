/**
 * 平台无关的组件接口定义
 */

import React from 'react';

// Button 组件接口
export interface ButtonProps {
  variant?: 'primary' | 'secondary';
  onPress?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

// Card 组件接口
export interface CardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

// Input 组件接口
export interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'email' | 'password';
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  required?: boolean;
  minLength?: number;
}

// Checkbox 组件接口
export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

// Form 组件接口
export interface FormProps {
  onSubmit: (e: React.FormEvent) => void;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

// FormGroup 组件接口
export interface FormGroupProps {
  label?: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

// ErrorMessage 组件接口
export interface ErrorMessageProps {
  message: string;
  className?: string;
  style?: React.CSSProperties;
}

// AuthSwitch 组件接口
export interface AuthSwitchProps {
  isLogin: boolean;
  onSwitch: () => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

// ThirdPartyAuth 组件接口
export interface ThirdPartyAuthProps {
  onThirdPartyLogin: (provider: 'wechat' | 'google' | 'qq') => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}
