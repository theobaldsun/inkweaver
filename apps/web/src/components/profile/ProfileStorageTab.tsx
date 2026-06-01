/**
 * 存储空间 Tab。
 */

import React from 'react';
import { StorageUsagePanel } from '@inkweaver/ui';

export const ProfileStorageTab: React.FC = () => (
  <div className="settings-content">
    <div className="section-card">
      <StorageUsagePanel pollIntervalMs={30_000} />
    </div>
  </div>
);
