import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Canonical permission keys used across the admin UI. Keep in sync with the
 * PERMISSIONS array in src/pages/admin/AdminRoles.tsx.
 */
export type PermissionKey =
  | 'view_users'
  | 'manage_users'
  | 'view_listings'
  | 'moderate_listings'
  | 'view_bookings'
  | 'manage_bookings'
  | 'view_disputes'
  | 'resolve_disputes'
  | 'view_payouts'
  | 'manage_payouts'
  | 'view_reports'
  | 'manage_platform_settings'
  | 'view_finance'
  | 'export_finance'
  | 'approve_finance';

interface PermissionsState {
  permissions: Set<PermissionKey>;
  loading: boolean;
  isAdmin: boolean;
}

/**
 * Resolves the effective permission set for the signed-in admin/staff user.
 *
 * Resolution order:
 *  1. If the user holds the built-in `admin` role (from `user_roles`), they
 *     receive ALL permissions — full platform access is hard-wired.
 *  2. Otherwise we look up every `custom_roles` row whose `name` matches one
 *     of their `user_roles.role` values (case-insensitive) and union the
 *     `permissions` arrays.
 */
export function usePermissions(): PermissionsState {
  const { roles, isAdmin, user, isLoading: authLoading } = useAuth();
  const [customPermissions, setCustomPermissions] = useState<Set<PermissionKey>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (authLoading || !user) {
        setLoading(authLoading);
        return;
      }
      // Built-in admin and super-admin roles get every permission — skip the lookup.
      const isSuperAdmin = roles.includes('superadmin' as any);
      if (isAdmin || isSuperAdmin) {
        if (!cancelled) {
          setCustomPermissions(new Set());
          setLoading(false);
        }
        return;
      }
      if (roles.length === 0) {
        if (!cancelled) {
          setCustomPermissions(new Set());
          setLoading(false);
        }
        return;
      }
      const lowered = roles.map((r) => r.toLowerCase());
      const set = new Set<PermissionKey>();
      // 1. Name-matched custom roles (legacy: when an enum role name === custom_role name)
      // 2. Direct custom-role assignments via user_custom_role_assignments
      const [allCustomRes, assignmentsRes] = await Promise.all([
        supabase.from('custom_roles' as any).select('id, name, permissions'),
        supabase
          .from('user_custom_role_assignments' as any)
          .select('custom_role_id')
          .eq('user_id', user.id),
      ]);
      const allCustom = (allCustomRes.data as any[]) ?? [];
      const assignedIds = new Set(((assignmentsRes.data as any[]) ?? []).map((a) => a.custom_role_id));
      allCustom.forEach((row) => {
        const matchedByName = lowered.includes(String(row.name).toLowerCase());
        const matchedById = assignedIds.has(row.id);
        if (matchedByName || matchedById) {
          (row.permissions ?? []).forEach((p: string) => set.add(p as PermissionKey));
        }
      });
      if (!cancelled) {
        setCustomPermissions(set);
        setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [roles, isAdmin, user, authLoading]);

  return useMemo(() => ({
    permissions: customPermissions,
    loading,
    isAdmin,
  }), [customPermissions, loading, isAdmin]);
}

/**
 * Convenience helper — returns true when the user has the requested permission
 * (or is a built-in admin).
 */
export function useHasPermission(key: PermissionKey): boolean {
  const { permissions, isAdmin } = usePermissions();
  return isAdmin || permissions.has(key);
}
