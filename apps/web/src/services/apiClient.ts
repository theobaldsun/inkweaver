import { setStorageAdapter } from '@inkweaver/services';
import { webStorageAdapter } from '@inkweaver/adapters';
import { apiClient } from '@inkweaver/api';

setStorageAdapter(webStorageAdapter);

export { apiClient };
export const httpClient = apiClient;
export { authService, documentService, userService, searchService, aiService } from '@inkweaver/services';
export { authApi, documentApi, folderApi, userApi, searchApi, storageApi, aiApi } from '@inkweaver/api';
