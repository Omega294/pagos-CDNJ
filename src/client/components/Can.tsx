import React from 'react';
import { useAuth } from '../context/AuthContext';

interface CanProps {
  permission: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Componente Guardián de Permisos Granulares (RBAC)
 * Renderiza el contenido solo si el usuario autenticado posee el permiso especificado.
 */
export const Can: React.FC<CanProps> = ({ permission, children, fallback = null }) => {
  const { hasPermission } = useAuth();

  if (!hasPermission(permission)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};
