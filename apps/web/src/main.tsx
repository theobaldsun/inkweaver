import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './index.css'
import { setStorageAdapter as setServicesStorage } from '@inkweaver/services';
import { setStorageAdapter as setApiStorage, createApiClient, apiClient } from '@inkweaver/api';
import { webStorageAdapter } from '@inkweaver/adapters';
import { API_BASE_URL } from './config/env';

setServicesStorage(webStorageAdapter);
setApiStorage(webStorageAdapter);

Object.assign(apiClient, createApiClient({ baseURL: API_BASE_URL }));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
