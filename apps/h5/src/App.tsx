import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthPage } from './pages/AuthPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { SharedDocumentPage } from './pages/SharedDocumentPage';
import { Alert } from './components/CustomModal';
import { NoteListPage } from './pages/NoteListPage';
import { SearchPage } from './pages/SearchPage';
import { ProfilePage } from './pages/ProfilePage';
import DocumentEditPage from './pages/DocumentEditPage';
import { AuthRoute } from './components/AuthRoute';
import { PlatformAdapterProvider } from '@inkweaver/ui';
import { platformAdapter } from './adapters/platformAdapter';
import './styles/main.css';

export const App: React.FC = () => {
  return (
    <PlatformAdapterProvider adapter={platformAdapter}>
      <Router>
        <div className="app-container">
          <Alert />
          <Routes>
            <Route path="/login" element={<AuthPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/shared/:token" element={<SharedDocumentPage />} />
            <Route element={<AuthRoute />}>
              <Route path="/notes" element={<NoteListPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/documents/new" element={<DocumentEditPage />} />
              <Route path="/documents/:id" element={<DocumentEditPage />} />
            </Route>
            <Route path="/" element={<Navigate to="/notes" replace />} />
            <Route path="*" element={<Navigate to="/notes" replace />} />
          </Routes>
        </div>
      </Router>
    </PlatformAdapterProvider>
  );
};
