/**
 * 平台无关的 Checkbox 组件
 */

import React from 'react';
import type { CheckboxProps } from '../types';
import { usePlatformAdapter } from '../adapters';

export const Checkbox: React.FC<CheckboxProps> = (props) => {
  const { Checkbox: PlatformCheckbox } = usePlatformAdapter();
  
  return <PlatformCheckbox {...props} />;
};
