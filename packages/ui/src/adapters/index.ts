/**
 * 平台适配器接口
 */

import React from 'react';
import type { ButtonProps, InputProps, CheckboxProps, CardProps } from '../types';

// 平台适配器接口
export interface PlatformAdapter {
  Button: React.FC<ButtonProps>;
  Input: React.FC<InputProps>;
  Checkbox: React.FC<CheckboxProps>;
  Card: React.FC<CardProps>;
}

// 平台适配器上下文
export const PlatformAdapterContext = React.createContext<PlatformAdapter | null>(null);

// 平台适配器提供者
export const PlatformAdapterProvider: React.FC<{
  adapter: PlatformAdapter;
  children: React.ReactNode;
}> = ({ adapter, children }) => {
  return React.createElement(
    PlatformAdapterContext.Provider,
    { value: adapter },
    children
  );
};

// 平台适配器钩子
export const usePlatformAdapter = (): PlatformAdapter => {
  const adapter = React.useContext(PlatformAdapterContext);
  if (!adapter) {
    throw new Error('Platform adapter not provided');
  }
  return adapter;
};
