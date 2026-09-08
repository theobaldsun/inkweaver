/**
 * 存储空间 Tab。
 */

import { StorageUsagePanel } from '@inkweaver/ui';
import React from 'react';

export const ProfileStorageTab: React.FC = () => (
  <div className="settings-content">
    <div className="section-card">
      <StorageUsagePanel pollIntervalMs={30_000} />
    </div>
  </div>
);
