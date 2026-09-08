import { webStorageAdapter } from '@inkweaver/adapters';
import { configureApiClient, setStorageAdapter as setApiStorage } from '@inkweaver/api';
import { setStorageAdapter as setServicesStorage } from '@inkweaver/services';
import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import { API_BASE_URL } from './config/env';
import './index.css';

setServicesStorage(webStorageAdapter);
setApiStorage(webStorageAdapter);

configureApiClient({ baseURL: API_BASE_URL });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
