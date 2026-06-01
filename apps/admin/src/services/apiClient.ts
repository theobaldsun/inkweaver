import { setStorageAdapter } from '@inkweaver/services';
import { webStorageAdapter } from '@inkweaver/adapters';

setStorageAdapter(webStorageAdapter);

export { authService, documentService, userService } from '@inkweaver/services';
export { authApi, documentApi, userApi, searchApi } from '@inkweaver/api';