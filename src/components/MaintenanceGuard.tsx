import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Construction, Shield } from 'lucide-react';

export function MaintenanceGuard({ children }: { children: React.ReactNode }) {
  const { isAdmin, isLoading: authLoading } = useAuth();
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchControls = async () => {
      const { data } = await supabase
        .from('platform_controls' as any)
        .select('settings')
        .eq('section', 'platform_settings')
        .single();
      if (data) {
        const s = (data as any).settings as Record<string, boolean>;
        setMaintenanceMode(!!s.maintenance_mode);
      }
      setLoading(false);
    };
    fetchControls();
  }, []);

  if (loading || authLoading) return null;

  if (maintenanceMode && !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="text-center max-w-md space-y-6">
          <div className="w-20 h-20 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto">
            <Construction className="w-10 h-10 text-amber-500" />
          </div>
          <h1 className="font-display text-3xl font-bold">Under Maintenance</h1>
          <p className="text-muted-foreground text-lg">
            We're performing scheduled maintenance to improve your experience. Please check back shortly.
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Shield className="w-4 h-4" />
            <span>Your data is safe and secure</span>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
