/**
 * 平台无关的 Card 组件
 */

import React from 'react';
import type { CardProps } from '../types';
import { usePlatformAdapter } from '../adapters';

export const Card: React.FC<CardProps> = (props) => {
  const { Card: PlatformCard } = usePlatformAdapter();
  
  return <PlatformCard {...props} />;
};
