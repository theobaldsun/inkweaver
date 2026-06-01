/**
 * 平台适配器包导出
 */

// Web端适配器
export { webStorageAdapter } from './web/storage';

// React Native端适配器
export { mobileStorageAdapter } from './mobile/storage';

// 类型导出
export type { StorageAdapter } from '@inkweaver/api';