import { ReactNode, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';
import { AdminSidebar } from './AdminSidebar';
import { usePlatformControls } from '@/hooks/usePlatformControls';
import { ShieldAlert } from 'lucide-react';

interface AdminLayoutProps {
  children: ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const { user, isAdmin, isLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { controls } = usePlatformControls();
  // Admin Controls: security.two_factor_auth — surface a persistent banner
  // reminding admins that 2FA is mandatory for staff accounts. Enrollment
  // itself is handled in the user's profile/security settings.
  const twoFactorRequired = controls.security.two_factor_auth === true;

  useEffect(() => {
    if (isLoading) return;
    if (!user) { navigate('/auth'); return; }
    if (!isAdmin) {
      navigate('/');
      toast({ title: t('admin.accessDenied'), description: t('admin.noPrivileges'), variant: 'destructive' });
      return;
    }
    // Persist admin mode
    localStorage.setItem('hostly_mode', 'admin');
  }, [user, isAdmin, isLoading, navigate]);

  if (isLoading || !user || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse space-y-4 text-center">
          <div className="w-12 h-12 rounded-xl bg-muted mx-auto" />
          <div className="h-4 bg-muted rounded w-32 mx-auto" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex w-full bg-background">
      <AdminSidebar />
      <main className="flex-1 overflow-y-auto">
        {twoFactorRequired && (
          <div className="bg-amber-500/10 border-b border-amber-500/30 px-6 py-2.5 flex items-center gap-2 text-xs">
            <ShieldAlert className="w-4 h-4 text-amber-600" />
            <span className="font-medium text-amber-700 dark:text-amber-400">
              {t('admin.layout.twoFactorRequired')}
            </span>
            <span className="text-muted-foreground hidden sm:inline">
              {t('admin.layout.twoFactorEnroll')}
            </span>
          </div>
        )}
        <div className="p-6 lg:p-8 max-w-[1400px]">
          {children}
        </div>
      </main>
    </div>
  );
}
