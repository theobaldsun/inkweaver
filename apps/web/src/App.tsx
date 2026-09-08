import { PlatformAdapterProvider } from "@inkweaver/ui";
import React, { Suspense } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";

import { platformAdapter } from "./adapters/platformAdapter";
import { AuthRoute } from "./components/AuthRoute";
import { Alert } from "./components/CustomModal";
import { Layout } from "./components/Layout";
import { ToastHost } from "./components/Toast";
import { FolderProvider } from "./contexts/FolderContext";
import { AiAskPage } from "./pages/AiAskPage";
import { AuthPage } from "./pages/AuthPage";
import NoteListPage from "./pages/NoteListPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { SearchPage } from "./pages/SearchPage";
import { SharedDocumentPage } from "./pages/SharedDocumentPage";
import TrashPage from "./pages/TrashPage";
import "./styles/auth.css";
import "./styles/main.css";

/** 懒加载编辑页，避免 editor-web 全局 CSS 在首屏污染主应用布局 */
const DocumentEditPage = React.lazy(() => import("./pages/DocumentEditPage"));

const DocumentEditRoute: React.FC = () => (
  <Suspense
    fallback={
      <div className="loading-container">
        <div className="loading-spinner" />
        <p className="loading-text">加载编辑器…</p>
      </div>
    }
  >
    <DocumentEditPage />
  </Suspense>
);

export const App: React.FC = () => {
  return (
    <PlatformAdapterProvider adapter={platformAdapter}>
      <Router>
        <div className="app-container">
          <ToastHost />
          <Alert />
          <Routes>
            <Route path="/login" element={<AuthPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/shared/:token" element={<SharedDocumentPage />} />

            <Route element={<AuthRoute />}>
              <Route
                path="*"
                element={
                  <FolderProvider>
                    <Layout>
                      <Routes>
                        <Route path="/notes" element={<NoteListPage />} />
                        <Route path="/search" element={<SearchPage />} />
                        <Route path="/ai" element={<AiAskPage />} />
                        <Route path="/profile" element={<ProfilePage />} />
                        <Route path="/trash" element={<TrashPage />} />
                        <Route path="/documents/new" element={<DocumentEditRoute />} />
                        <Route path="/documents/:id" element={<DocumentEditRoute />} />
                        <Route path="/" element={<Navigate to="/notes" replace />} />
                      </Routes>
                    </Layout>
                  </FolderProvider>
                }
              />
            </Route>

            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </div>
      </Router>
    </PlatformAdapterProvider>
  );
};
