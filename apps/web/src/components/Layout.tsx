import React from 'react';
import Sidebar from './Sidebar';
import Header from './Header';

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