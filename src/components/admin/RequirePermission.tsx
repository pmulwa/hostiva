import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { usePermissions, type PermissionKey } from '@/hooks/usePermissions';

interface RequirePermissionProps {
  permission: PermissionKey;
  children: ReactNode;
  /** When true, render an inline "no access" message instead of redirecting. */
  inline?: boolean;
}

/**
 * Route-level guard. Redirects (or shows a fallback) when the current admin
 * lacks the required permission. Built-in admins bypass the check.
 */
export function RequirePermission({ permission, children, inline }: RequirePermissionProps) {
  const { permissions, isAdmin, loading } = usePermissions();

  if (loading) {
    return (
      <AdminLayout>
        <div className="animate-pulse h-64 bg-muted rounded-xl" />
      </AdminLayout>
    );
  }

  const allowed = isAdmin || permissions.has(permission);
  if (allowed) return <>{children}</>;

  if (!inline) {
    // Send them somewhere safe — the dashboard.
    return <Navigate to="/admin" replace />;
  }

  return (
    <AdminLayout>
      <div className="max-w-md mx-auto text-center py-16">
        <div className="w-12 h-12 rounded-xl bg-muted mx-auto flex items-center justify-center mb-4">
          <Lock className="w-5 h-5 text-muted-foreground" />
        </div>
        <h1 className="font-display text-xl font-bold mb-1">Access restricted</h1>
        <p className="text-sm text-muted-foreground">
          You don't have the <strong>{permission.replace(/_/g, ' ')}</strong> permission for this section. Contact a platform administrator.
        </p>
      </div>
    </AdminLayout>
  );
}
