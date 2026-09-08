import React from 'react';

import Header from './Header';
import Sidebar from './Sidebar';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <>
      <Sidebar />
      <div className="main-content-wrapper">
        <Header />
        <main className="main-area">
          {children}
        </main>
      </div>
    </>
  );
};