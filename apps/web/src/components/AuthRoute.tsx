import { authService } from '@inkweaver/services';
import React, { useState, useEffect } from 'react';
import { Outlet, Navigate } from 'react-router-dom';

export const AuthRoute: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      const loggedIn = await authService.ensureSession();
      setIsAuthenticated(loggedIn);
    };
    checkAuth();
  }, []);

  if (isAuthenticated === null) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};
