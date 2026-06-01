/**
 * 平台无关的 Input 组件
 */

import React from 'react';
import type { InputProps } from '../types';
import { usePlatformAdapter } from '../adapters';

export const Input: React.FC<InputProps> = (props) => {
  const { Input: PlatformInput } = usePlatformAdapter();
  
  return <PlatformInput {...props} />;
};
