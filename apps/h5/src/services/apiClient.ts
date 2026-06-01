/**
 * H5 API 与服务导出（与 Web 对齐）。
 */

import { setStorageAdapter } from '@inkweaver/services';
import { webStorageAdapter } from '@inkweaver/adapters';
import { apiClient } from '@inkweaver/api';

setStorageAdapter(webStorageAdapter);

export { apiClient };
export { authService, documentService, userService, searchService } from '@inkweaver/services';
export { authApi, documentApi, folderApi, userApi, searchApi, storageApi, notificationApi } from '@inkweaver/api';
