import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3, Users, Home, Calendar, DollarSign, Shield,
  Settings, FileText, Sliders, Star, ChevronLeft, LogOut, PlaneTakeoff, ScrollText, Wallet,
  MessageSquareWarning, BookOpen, ShieldAlert, CloudLightning, Award, KeyRound, MessageSquare,
  Scale,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions, type PermissionKey } from '@/hooks/usePermissions';

type AdminSection = {
  key: string;
  icon: typeof BarChart3;
  path: string;
  label?: string;
  requires?: PermissionKey;
};

const adminSections: AdminSection[] = [
  { key: 'users', icon: Users, path: '/admin/users', requires: 'view_users' },
  { key: 'dashboard', icon: BarChart3, path: '/admin/dashboard' },
  { key: 'verifications', icon: Shield, path: '/admin/verifications', requires: 'manage_users' },
  { key: 'properties', icon: Home, path: '/admin/properties', requires: 'view_listings' },
  { key: 'bookings', icon: Calendar, path: '/admin/bookings', requires: 'view_bookings' },
  { key: 'messages', icon: MessageSquare, path: '/admin/messages' },
  { key: 'financials', icon: DollarSign, path: '/admin/financials', requires: 'view_payouts' },
  { key: 'accounting', icon: BookOpen, path: '/admin/accounting', requires: 'view_payouts' },
  { key: 'reconciliation', icon: Scale, path: '/admin/reconciliation', requires: 'view_payouts', label: 'Reconciliation' },
  { key: 'accountingPin', icon: KeyRound, path: '/admin/accounting-pin', requires: 'manage_platform_settings', label: 'Accounting PIN override' },
  { key: 'hostPayments', icon: Wallet, path: '/admin/host-payments', requires: 'manage_payouts' },
  { key: 'reviews', icon: Star, path: '/admin/reviews' },
  { key: 'moderation', icon: MessageSquareWarning, path: '/admin/moderation', requires: 'moderate_listings' },
  { key: 'trustSafety', icon: ShieldAlert, path: '/admin/trust-safety', requires: 'resolve_disputes' },
  { key: 'reviewQueue', icon: Shield, path: '/admin/review-queue', requires: 'resolve_disputes' },
  { key: 'forceMajeure', icon: CloudLightning, path: '/admin/force-majeure', requires: 'manage_platform_settings' },
  { key: 'controls', icon: Sliders, path: '/admin/controls', requires: 'manage_platform_settings' },
  { key: 'roles', icon: KeyRound, path: '/admin/roles', requires: 'manage_platform_settings' },
  { key: 'reports', icon: FileText, path: '/admin/reports', requires: 'view_reports' },
  { key: 'settings', icon: Settings, path: '/admin/settings', requires: 'manage_platform_settings' },
  { key: 'auditLog', icon: ScrollText, path: '/admin/audit-log', requires: 'manage_platform_settings' },
];

export function AdminSidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { permissions, isAdmin } = usePermissions();

  const visibleSections = adminSections.filter(
    (item) => !item.requires || isAdmin || permissions.has(item.requires),
  );

  const isActive = (path: string) => {
    if (path === '/admin/users') {
      return location.pathname === '/admin' || location.pathname.startsWith('/admin/users');
    }
    if (path === '/admin/dashboard') return location.pathname === '/admin/dashboard';
    return location.pathname.startsWith(path);
  };

  const exitAdmin = () => {
    localStorage.removeItem('hostly_mode');
    navigate('/');
  };

  return (
    <aside className="w-64 min-h-screen bg-card border-r border-border flex flex-col shrink-0">
      {/* Admin Branding */}
      <div className="p-5 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-foreground">{t('admin.sidebar.brand', 'Hostiva Admin')}</h2>
            <p className="text-[11px] text-muted-foreground truncate max-w-[140px]">
              {profile?.full_name || profile?.email}
            </p>
          </div>
        </div>
      </div>

      {/* Nav Items */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {visibleSections.map((item) => (
          <button
            key={item.key}
            onClick={() => navigate(item.path)}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
              isActive(item.path)
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <item.icon className="w-4.5 h-4.5 shrink-0" />
            <span>{(item as { label?: string }).label || t(`admin.sidebar.${item.key}`)}</span>
          </button>
        ))}
      </nav>

      <Separator />

      {/* Bottom Actions */}
      <div className="p-3 space-y-1">
        <button
          onClick={exitAdmin}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
        >
          <PlaneTakeoff className="w-4.5 h-4.5" />
          <span>{t('admin.sidebar.exitAdmin')}</span>
        </button>
      </div>
    </aside>
  );
}
