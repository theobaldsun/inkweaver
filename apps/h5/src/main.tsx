import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './index.css'
import { setStorageAdapter as setServicesStorage } from '@inkweaver/services';
import { setStorageAdapter as setApiStorage, createApiClient, apiClient } from '@inkweaver/api';
import { webStorageAdapter } from '@inkweaver/adapters';

// 设置Web端存储适配器（同时为services和api包设置）
setServicesStorage(webStorageAdapter);
setApiStorage(webStorageAdapter);

// 重新配置API客户端使用相对路径以利用Vite代理
Object.assign(apiClient, createApiClient({ baseURL: '/api' }));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)