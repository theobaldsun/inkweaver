import { webStorageAdapter } from '@inkweaver/adapters';
import { apiClient } from '@inkweaver/api';
import { setStorageAdapter } from '@inkweaver/services';

setStorageAdapter(webStorageAdapter);

export { apiClient };
export const httpClient = apiClient;
export { authService, documentService, userService, searchService, aiService } from '@inkweaver/services';
export { authApi, documentApi, folderApi, userApi, searchApi, storageApi, aiApi } from '@inkweaver/api';
