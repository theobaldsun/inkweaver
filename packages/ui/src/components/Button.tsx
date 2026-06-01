/**
 * 平台无关的 Button 组件
 */

import React from 'react';
import type { ButtonProps } from '../types';
import { usePlatformAdapter } from '../adapters';

export const Button: React.FC<ButtonProps> = (props) => {
  const { Button: PlatformButton } = usePlatformAdapter();
  
  const handlePress = () => {
    if (!props.disabled && props.onPress) {
      props.onPress();
    }
  };
  
  return <PlatformButton {...props} onPress={handlePress} />;
};
