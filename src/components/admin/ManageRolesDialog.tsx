import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { logAdminAction } from '@/lib/audit';
import { Shield, Headphones, Wallet, Users, MessageSquareWarning, Settings, Megaphone, Home, User, ShieldCheck, UsersRound, AlertTriangle } from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';

type AppRole = Database['public']['Enums']['app_role'];

export interface RoleOption {
  value: AppRole;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeClass: string;
  group: 'core' | 'staff';
}

export const ROLE_OPTIONS: RoleOption[] = [
  { value: 'guest', label: 'Guest', description: 'Default role — can browse and book properties.', icon: User, badgeClass: 'bg-blue-500/10 text-blue-600 border-blue-500/30', group: 'core' },
  { value: 'host', label: 'Host', description: 'Can create and manage property listings.', icon: Home, badgeClass: 'bg-amber-500/10 text-amber-600 border-amber-500/30', group: 'core' },
  { value: 'cohost' as AppRole, label: 'Co-Host', description: 'Delegated manager for an existing host listing.', icon: UsersRound, badgeClass: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/30', group: 'core' },
  { value: 'admin', label: 'Admin', description: 'Full platform access including all settings and user management.', icon: Shield, badgeClass: 'bg-primary/10 text-primary border-primary/30', group: 'core' },
  { value: 'superadmin' as AppRole, label: 'Super Admin', description: 'Root-level access — every capability is granted automatically.', icon: ShieldCheck, badgeClass: 'bg-red-500/10 text-red-600 border-red-500/30', group: 'core' },
  { value: 'customer_care', label: 'Customer Care', description: 'Front-line support — handles guest & host inquiries.', icon: Headphones, badgeClass: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/30', group: 'staff' },
  { value: 'finance_officer', label: 'Finance Officer', description: 'Manages payouts, refunds, and financial reports.', icon: Wallet, badgeClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30', group: 'staff' },
  { value: 'hr', label: 'HR', description: 'Manages internal staff and people operations.', icon: Users, badgeClass: 'bg-purple-500/10 text-purple-600 border-purple-500/30', group: 'staff' },
  { value: 'moderator', label: 'Content Mod', description: 'Reviews flagged content, listings, and reviews.', icon: MessageSquareWarning, badgeClass: 'bg-orange-500/10 text-orange-600 border-orange-500/30', group: 'staff' },
  { value: 'operations', label: 'Operations', description: 'Day-to-day platform operations and oversight.', icon: Settings, badgeClass: 'bg-slate-500/10 text-slate-600 border-slate-500/30', group: 'staff' },
  { value: 'marketing', label: 'Marketing', description: 'Manages campaigns, promotions, and outreach.', icon: Megaphone, badgeClass: 'bg-pink-500/10 text-pink-600 border-pink-500/30', group: 'staff' },
];

export function getRoleOption(role: string): RoleOption | undefined {
  return ROLE_OPTIONS.find((r) => r.value === role);
}

interface ManageRolesDialogProps {
  userId: string | null;
  userName?: string;
  currentRoles: AppRole[];
  onClose: () => void;
  onSaved: () => void;
}

export function ManageRolesDialog({ userId, userName, currentRoles, onClose, onSaved }: ManageRolesDialogProps) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<AppRole>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [customRoles, setCustomRoles] = useState<{ id: string; name: string; description: string | null }[]>([]);
  const [selectedCustom, setSelectedCustom] = useState<Set<string>>(new Set());
  const [originalCustom, setOriginalCustom] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    setSelected(new Set(currentRoles));
  }, [currentRoles, userId]);

  // Load custom roles + the user's existing custom assignments whenever the dialog opens.
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const [rolesRes, assignmentsRes] = await Promise.all([
        supabase
          .from('custom_roles' as any)
          .select('id, name, description, is_builtin')
          .eq('is_builtin', false)
          .order('name'),
        supabase
          .from('user_custom_role_assignments' as any)
          .select('custom_role_id')
          .eq('user_id', userId),
      ]);
      const roles = ((rolesRes.data as any[]) ?? []).map((r) => ({ id: r.id, name: r.name, description: r.description }));
      setCustomRoles(roles);
      const assigned = new Set<string>(
        ((assignmentsRes.data as any[]) ?? []).map((a) => a.custom_role_id),
      );
      setSelectedCustom(assigned);
      setOriginalCustom(new Set(assigned));
    })();
  }, [userId]);

  const toggle = (role: AppRole) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  };

  const toggleCustom = (id: string) => {
    setSelectedCustom((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Compute the diff between current and pending selection. */
  const computeDiff = () => {
    const before = new Set(currentRoles);
    const toAdd: AppRole[] = [...selected].filter((r) => !before.has(r));
    const toRemove: AppRole[] = [...before].filter((r) => !selected.has(r));
    const customToAdd = [...selectedCustom].filter((id) => !originalCustom.has(id));
    const customToRemove = [...originalCustom].filter((id) => !selectedCustom.has(id));
    return { toAdd, toRemove, customToAdd, customToRemove };
  };

  const diff = computeDiff();
  const hasChanges =
    diff.toAdd.length + diff.toRemove.length + diff.customToAdd.length + diff.customToRemove.length > 0;

  /** Trigger confirmation flow. If nothing changed, just close. */
  const requestSave = () => {
    if (!hasChanges) {
      onClose();
      return;
    }
    setConfirmOpen(true);
  };

  const handleSave = async () => {
    if (!userId) return;
    setConfirmOpen(false);
    setIsSaving(true);
    try {
      const { toAdd, toRemove, customToAdd, customToRemove } = computeDiff();

      if (toRemove.length > 0) {
        await supabase.from('user_roles').delete().eq('user_id', userId).in('role', toRemove);
      }
      if (toAdd.length > 0) {
        const rows = toAdd.map((role) => ({ user_id: userId, role }));
        await supabase.from('user_roles').insert(rows);
      }

      // Mirror host flag on profile
      if (toAdd.includes('host') || toRemove.includes('host')) {
        await supabase.from('profiles').update({ is_host: selected.has('host') }).eq('user_id', userId);
      }

      if (customToRemove.length > 0) {
        await supabase
          .from('user_custom_role_assignments' as any)
          .delete()
          .eq('user_id', userId)
          .in('custom_role_id', customToRemove);
      }
      if (customToAdd.length > 0) {
        const { data: userRes } = await supabase.auth.getUser();
        const rows = customToAdd.map((custom_role_id) => ({
          user_id: userId,
          custom_role_id,
          assigned_by: userRes.user?.id ?? null,
        }));
        await supabase.from('user_custom_role_assignments' as any).insert(rows as any);
      }

      await logAdminAction('manage_roles', 'user', userId, {
        added: toAdd,
        removed: toRemove,
        final: [...selected],
        custom_added: customToAdd,
        custom_removed: customToRemove,
      });

      const totalAdded = toAdd.length + customToAdd.length;
      const totalRemoved = toRemove.length + customToRemove.length;
      toast({ title: 'Roles updated', description: `${totalAdded} added, ${totalRemoved} removed.` });
      onSaved();
      onClose();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message ?? 'Failed to update roles', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const renderGroup = (group: 'core' | 'staff', title: string, subtitle: string) => (
    <div>
      <div className="mb-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className="space-y-2">
        {ROLE_OPTIONS.filter((r) => r.group === group).map((role) => {
          const Icon = role.icon;
          const checked = selected.has(role.value);
          return (
            <label
              key={role.value}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                checked ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted/50'
              }`}
            >
              <Checkbox checked={checked} onCheckedChange={() => toggle(role.value)} className="mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <Badge variant="outline" className={role.badgeClass}>{role.label}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{role.description}</p>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );

  const renderCustomGroup = () => {
    if (customRoles.length === 0) return null;
    return (
      <div>
        <div className="mb-2">
          <h4 className="text-sm font-semibold">Custom Roles</h4>
          <p className="text-xs text-muted-foreground">Defined by admins under Roles &amp; permissions</p>
        </div>
        <div className="space-y-2">
          {customRoles.map((role) => {
            const checked = selectedCustom.has(role.id);
            return (
              <label
                key={role.id}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  checked ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted/50'
                }`}
              >
                <Checkbox checked={checked} onCheckedChange={() => toggleCustom(role.id)} className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">{role.name}</Badge>
                  </div>
                  {role.description && <p className="text-xs text-muted-foreground">{role.description}</p>}
                </div>
              </label>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={!!userId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Manage Roles</DialogTitle>
          <DialogDescription>
            {userName ? `Assign one or more roles to ${userName}.` : 'Assign one or more roles to this user.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {renderGroup('core', 'Core Roles', 'Marketplace access levels')}
          <Separator />
          {renderGroup('staff', 'Staff Roles', 'Internal team responsibilities')}
          {customRoles.length > 0 && <Separator />}
          {renderCustomGroup()}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button onClick={requestSave} disabled={isSaving || !userId}>
            {isSaving ? 'Saving…' : 'Save Roles'}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Role-change confirmation */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" /> Confirm role change
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  You are about to change roles for <strong>{userName ?? 'this user'}</strong>. Permissions take effect immediately and may grant or revoke sensitive access.
                </p>
                {diff.toAdd.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600 mb-1">Granting</p>
                    <div className="flex flex-wrap gap-1.5">
                      {diff.toAdd.map((r) => {
                        const opt = ROLE_OPTIONS.find((o) => o.value === r);
                        return <Badge key={r} variant="outline" className={opt?.badgeClass}>{opt?.label ?? r}</Badge>;
                      })}
                    </div>
                  </div>
                )}
                {diff.toRemove.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-destructive mb-1">Revoking</p>
                    <div className="flex flex-wrap gap-1.5">
                      {diff.toRemove.map((r) => {
                        const opt = ROLE_OPTIONS.find((o) => o.value === r);
                        return <Badge key={r} variant="outline" className="border-destructive/40 text-destructive">{opt?.label ?? r}</Badge>;
                      })}
                    </div>
                  </div>
                )}
                {(diff.customToAdd.length > 0 || diff.customToRemove.length > 0) && (
                  <p className="text-xs text-muted-foreground">
                    {diff.customToAdd.length} custom role(s) added, {diff.customToRemove.length} removed.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSave} disabled={isSaving}>
              Apply changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}