import { useEffect, useMemo, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Plus, Trash2, Loader2, Shield, ShieldCheck, Headphones, Wallet,
  Users, MessageSquareWarning, Settings, Megaphone, Home, User, Check, Pencil,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { logAdminAction } from '@/lib/audit';

type CustomRole = {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  is_builtin: boolean;
};

type Permission = { key: string; label: string };

const PERMISSIONS: Permission[] = [
  { key: 'view_listings', label: 'Search & book listings' },
  { key: 'create_listings', label: 'Create / edit listings' },
  { key: 'moderate_listings', label: 'Manage scoped listings' },
  { key: 'view_users', label: 'View all user records' },
  { key: 'manage_users', label: 'Suspend / restrict users' },
  { key: 'ban_users', label: 'Permanently ban users' },
  { key: 'delete_users', label: 'Delete user (GDPR)' },
  { key: 'issue_refunds_small', label: 'Issue refunds < $500' },
  { key: 'issue_refunds_large', label: 'Issue refunds ≥ $500' },
  { key: 'manage_payouts', label: 'Process host payouts' },
  { key: 'create_staff', label: 'Create staff accounts' },
  { key: 'access_hr_records', label: 'Access HR records' },
  { key: 'review_flagged_content', label: 'Review flagged content' },
  { key: 'impersonate_users', label: 'Impersonate user (audited)' },
  { key: 'investigate_fraud', label: 'Investigate fraud' },
  { key: 'modify_role_permissions', label: 'Modify role permissions' },
  { key: 'view_finance', label: 'View finance & accounting' },
  { key: 'export_finance', label: 'Export financial statements' },
  { key: 'approve_finance', label: 'Approve / sign-off statements' },
];

type RoleMeta = {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  iconBg: string;
  shortLabel: string;
  columnColor: string;
};

const BUILTIN_META: Record<string, RoleMeta> = {
  guest:           { icon: User,                 iconColor: 'text-slate-300',   iconBg: 'bg-slate-500/15',   shortLabel: 'GUEST',     columnColor: 'text-slate-300' },
  host:            { icon: Home,                 iconColor: 'text-emerald-400', iconBg: 'bg-emerald-500/15', shortLabel: 'HOST',      columnColor: 'text-emerald-400' },
  cohost:          { icon: Users,                iconColor: 'text-cyan-400',    iconBg: 'bg-cyan-500/15',    shortLabel: 'CO-HOST',   columnColor: 'text-cyan-400' },
  admin:           { icon: Shield,               iconColor: 'text-red-400',     iconBg: 'bg-red-500/15',     shortLabel: 'ADMIN',     columnColor: 'text-red-400' },
  superadmin:      { icon: ShieldCheck,          iconColor: 'text-red-500',     iconBg: 'bg-red-600/15',     shortLabel: 'SUPER',     columnColor: 'text-red-500' },
  customer_care:   { icon: Headphones,           iconColor: 'text-purple-400',  iconBg: 'bg-purple-500/15',  shortLabel: 'CUSTOMER',  columnColor: 'text-purple-400' },
  hr:              { icon: Users,                iconColor: 'text-pink-400',    iconBg: 'bg-pink-500/15',    shortLabel: 'HR',        columnColor: 'text-pink-400' },
  finance_officer: { icon: Wallet,               iconColor: 'text-amber-400',   iconBg: 'bg-amber-500/15',   shortLabel: 'FINANCE',   columnColor: 'text-amber-400' },
  trust:           { icon: ShieldCheck,          iconColor: 'text-orange-400',  iconBg: 'bg-orange-500/15',  shortLabel: 'TRUST',     columnColor: 'text-orange-400' },
  moderator:       { icon: MessageSquareWarning, iconColor: 'text-blue-400',    iconBg: 'bg-blue-500/15',    shortLabel: 'CONTENT',   columnColor: 'text-blue-400' },
  operations:      { icon: Settings,             iconColor: 'text-slate-400',   iconBg: 'bg-slate-500/15',   shortLabel: 'OPS',       columnColor: 'text-slate-400' },
  marketing:       { icon: Megaphone,            iconColor: 'text-rose-400',    iconBg: 'bg-rose-500/15',    shortLabel: 'MARKETING', columnColor: 'text-rose-400' },
};

const FALLBACK_META: RoleMeta = {
  icon: ShieldCheck,
  iconColor: 'text-primary',
  iconBg: 'bg-primary/15',
  shortLabel: 'CUSTOM',
  columnColor: 'text-primary',
};

const friendlyRoleName = (raw: string) => {
  const map: Record<string, string> = {
    guest: 'Guest', host: 'Host', cohost: 'Co-Host', admin: 'Admin',
    superadmin: 'Super Admin', customer_care: 'Customer Care', hr: 'HR',
    finance_officer: 'Finance', trust: 'Trust & Safety', moderator: 'Content Mod',
    operations: 'Operations', marketing: 'Marketing',
  };
  return map[raw] ?? raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

const roleDescriptions: Record<string, string> = {
  guest: 'Browse and book stays',
  host: 'List and manage properties',
  cohost: 'Delegated listing manager',
  admin: 'Platform-wide authority',
  superadmin: 'Root-level access',
  customer_care: 'Handles tickets & disputes',
  hr: 'Staff & employee records',
  finance_officer: 'Payouts & reconciliation',
  trust: 'Fraud & policy enforcement',
  moderator: 'Reviews listings & content',
  operations: 'Day-to-day platform ops',
  marketing: 'Campaigns & promotions',
};

export default function AdminRoles() {
  const { toast } = useToast();
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<CustomRole | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CustomRole | null>(null);

  const fetchRoles = async (opts?: { silent?: boolean }) => {
    if (opts?.silent) setRefreshing(true);
    else setLoading(true);
    const { data, error } = await supabase
      .from('custom_roles' as any)
      .select('*')
      .order('is_builtin', { ascending: false })
      .order('name');
    if (error) {
      toast({ title: 'Failed to load roles', description: error.message, variant: 'destructive' });
    } else {
      setRoles((data as any) ?? []);
    }
    if (opts?.silent) setRefreshing(false);
    else setLoading(false);
  };

  useEffect(() => { fetchRoles(); }, []);

  const handleDelete = async () => {
    if (!deleting) return;
    const { error } = await supabase.from('custom_roles' as any).delete().eq('id', deleting.id);
    if (error) {
      toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
    } else {
      await logAdminAction('delete_role', 'custom_role', deleting.id, { name: deleting.name });
      toast({ title: 'Role deleted', description: `${deleting.name} has been removed.` });
      setDeleting(null);
      fetchRoles();
    }
  };

  const handleToggleMatrix = async (role: CustomRole, permKey: string) => {
    const has = role.permissions.includes(permKey);
    const next = has ? role.permissions.filter((p) => p !== permKey) : [...role.permissions, permKey];
    const prev = roles;
    setRoles((rs) => rs.map((r) => (r.id === role.id ? { ...r, permissions: next } : r)));
    const { error } = await supabase
      .from('custom_roles' as any)
      .update({ permissions: next })
      .eq('id', role.id);
    if (error) {
      setRoles(prev);
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
    } else {
      await logAdminAction('update_role_permission', 'custom_role', role.id, { perm: permKey, granted: !has });
    }
  };

  const sortedRoles = useMemo(() => {
    const builtinOrder = ['guest', 'host', 'cohost', 'admin', 'superadmin', 'customer_care', 'hr', 'finance_officer', 'trust', 'moderator', 'operations', 'marketing'];
    return [...roles].sort((a, b) => {
      if (a.is_builtin && b.is_builtin) {
        const ai = builtinOrder.indexOf(a.name.toLowerCase());
        const bi = builtinOrder.indexOf(b.name.toLowerCase());
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      }
      if (a.is_builtin) return -1;
      if (b.is_builtin) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [roles]);

  const metaFor = (role: CustomRole): RoleMeta =>
    BUILTIN_META[role.name.toLowerCase()] ?? FALLBACK_META;

  return (
    <AdminLayout>
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2 font-mono">
          RBAC / Principle of Least Privilege
        </p>
        <h1 className="font-display text-4xl font-bold">Roles &amp; permissions</h1>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading roles…
        </div>
      ) : (
        <>
          {/* Role cards grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-10">
            {sortedRoles.map((role) => {
              const meta = metaFor(role);
              const Icon = meta.icon;
              return (
                <button
                  key={role.id}
                  onClick={() => setEditing(role)}
                  className="group text-left rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:bg-card/80 cursor-pointer"
                  title="Edit role"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${meta.iconBg}`}>
                      <Icon className={`w-4 h-4 ${meta.iconColor}`} />
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditing(role); }}
                        className="text-muted-foreground hover:text-primary transition-colors p-1 rounded hover:bg-muted/40"
                        title="Edit role"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {!role.is_builtin && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleting(role); }}
                          className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded hover:bg-muted/40"
                          title="Delete role"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <h3 className="font-bold text-sm mb-0.5">{friendlyRoleName(role.name)}</h3>
                  <p className={`text-[10px] uppercase tracking-wider mb-2 font-mono ${meta.columnColor}`}>
                    {meta.shortLabel}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {role.description || roleDescriptions[role.name.toLowerCase()] || 'Custom role'}
                  </p>
                </button>
              );
            })}

            <button
              onClick={() => setCreating(true)}
              className="rounded-xl border border-dashed border-border bg-card/40 p-4 transition-all hover:border-primary/60 hover:bg-card flex flex-col items-center justify-center text-muted-foreground hover:text-primary min-h-[148px]"
            >
              <Plus className="w-6 h-6 mb-1.5" />
              <span className="text-xs font-semibold">New role</span>
            </button>
          </div>

          {/* Capability matrix */}
          <div className="mb-4 flex items-center gap-3">
            <h2 className="font-display text-2xl font-bold">Capability matrix</h2>
            {refreshing && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Refreshing…
              </span>
            )}
          </div>

          <Card className={`card-luxury overflow-hidden transition-opacity ${refreshing ? 'opacity-60' : ''}`}>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-4 px-5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono font-normal">
                        Capability
                      </th>
                      {sortedRoles.map((role) => {
                        const meta = metaFor(role);
                        return (
                          <th key={role.id} className={`text-center py-4 px-3 text-[10px] uppercase tracking-[0.15em] font-mono font-normal ${meta.columnColor}`}>
                            {meta.shortLabel}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {PERMISSIONS.map((perm, i) => (
                      <tr key={perm.key} className={`border-b border-border/60 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? 'bg-transparent' : 'bg-muted/5'}`}>
                        <td className="py-3.5 px-5 text-foreground/90">{perm.label}</td>
                        {sortedRoles.map((role) => {
                          const meta = metaFor(role);
                          const has = role.permissions.includes(perm.key);
                          return (
                            <td key={role.id} className="text-center py-3.5 px-3">
                              <span
                                aria-disabled="true"
                                className={`inline-flex items-center justify-center w-7 h-7 rounded-md cursor-default select-none ${
                                  has ? meta.columnColor : 'text-muted-foreground/30'
                                }`}
                                title="Read-only — edit the role to change this permission"
                              >
                                {has ? <Check className="w-4 h-4" strokeWidth={2.5} /> : <span className="text-base leading-none">—</span>}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <p className="text-[11px] text-muted-foreground mt-4 font-mono">
            Read-only view. To change permissions, click the corresponding role card above and edit it.
          </p>
        </>
      )}

      {(creating || editing) && (
        <RoleEditorDialog
          role={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={async (saved) => {
            // 1. Optimistically update the matrix immediately
            setRoles((prev) => {
              const idx = prev.findIndex((r) => r.id === saved.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = { ...next[idx], name: saved.name, description: saved.description, permissions: saved.permissions };
                return next;
              }
              // Newly created role — append (mark non-builtin)
              return [
                ...prev,
                { id: saved.id ?? crypto.randomUUID(), name: saved.name, description: saved.description, permissions: saved.permissions, is_builtin: false },
              ];
            });
            setCreating(false);
            setEditing(null);
            toast({
              title: 'Permissions updated',
              description: `${saved.name} is now reflected in the capability matrix.`,
            });
            // 2. Re-sync silently with the server in the background
            fetchRoles({ silent: true });
          }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete role?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the <strong>{deleting?.name}</strong> role definition. Any users currently assigned this role will lose its permissions immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}

interface RoleEditorDialogProps {
  role: CustomRole | null;
  onClose: () => void;
  onSaved: (saved: { id?: string; name: string; description: string | null; permissions: string[] }) => void;
}

function RoleEditorDialog({ role, onClose, onSaved }: RoleEditorDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [permissions, setPermissions] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [saving, setSaving] = useState(false);

  const togglePermission = (key: string) => {
    setPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({ title: 'Name required', description: 'Please enter a role name.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      permissions: [...permissions],
    };

    if (role) {
      const { data, error } = await supabase
        .from('custom_roles' as any)
        .update(payload)
        .eq('id', role.id)
        .select()
        .maybeSingle();
      if (error) {
        toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
        setSaving(false);
        return;
      }
      if (!data) {
        toast({
          title: 'Update blocked',
          description: 'You don\'t have permission to update this role, or the row no longer exists.',
          variant: 'destructive',
        });
        setSaving(false);
        return;
      }
      await logAdminAction('update_role', 'custom_role', role.id, payload);
      toast({ title: 'Role updated', description: `${payload.name} saved.` });
      setSaving(false);
      onSaved({ id: role.id, ...payload });
      return;
    } else {
      const { data: userRes } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('custom_roles' as any)
        .insert({ ...payload, created_by: userRes.user?.id, is_builtin: false } as any)
        .select()
        .single();
      if (error) {
        toast({ title: 'Create failed', description: error.message, variant: 'destructive' });
        setSaving(false);
        return;
      }
      await logAdminAction('create_role', 'custom_role', (data as any)?.id ?? '', payload);
      toast({ title: 'Role created', description: `${payload.name} is now available to assign.` });
      setSaving(false);
      onSaved({ id: (data as any)?.id, ...payload });
      return;
    }
  };

  const left = PERMISSIONS.slice(0, Math.ceil(PERMISSIONS.length / 2));
  const right = PERMISSIONS.slice(Math.ceil(PERMISSIONS.length / 2));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{role ? 'Edit Role' : 'Create New Role'}</DialogTitle>
          <DialogDescription>
            {role ? 'Update the name, description, and permissions for this role.' : 'Define a new role with a tailored set of permissions. It will appear in the matrix and become assignable in user management.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="role-name" className="text-sm font-medium mb-1.5 block">Role Name</Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Auditor"
              disabled={!!role?.is_builtin}
            />
            {role?.is_builtin && (
              <p className="text-[10px] text-muted-foreground mt-1">Built-in role names are locked. You can still edit description and permissions.</p>
            )}
          </div>
          <div>
            <Label htmlFor="role-desc" className="text-sm font-medium mb-1.5 block">Description</Label>
            <Input
              id="role-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this role do?"
            />
          </div>
          <div>
            <Label className="text-sm font-medium mb-2 block">Permissions</Label>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 max-h-72 overflow-y-auto pr-1">
              {[left, right].map((col, i) => (
                <div key={i} className="space-y-2.5">
                  {col.map((perm) => (
                    <label key={perm.key} className="flex items-start gap-2 cursor-pointer text-xs leading-snug">
                      <Checkbox
                        checked={permissions.has(perm.key)}
                        onCheckedChange={() => togglePermission(perm.key)}
                        className="mt-0.5"
                      />
                      <span>{perm.label}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
            {role ? 'Save Changes' : 'Create Role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}