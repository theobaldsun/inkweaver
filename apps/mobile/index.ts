/**
 * Mobile（React Native）入口
 */
import { registerRootComponent } from 'expo';
import App from './src/App';
import { setStorageAdapter as setServicesStorage } from '@inkweaver/services';
import { setStorageAdapter as setApiStorage } from '@inkweaver/api';
import { mobileStorageAdapter } from '@inkweaver/adapters';

// 设置React Native端存储适配器（同时为services和api包设置）
setServicesStorage(mobileStorageAdapter);
setApiStorage(mobileStorageAdapter);

// 使用 Expo 的根组件注册
export default registerRootComponent(App);