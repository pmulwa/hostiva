import { useState, useEffect, useMemo, useRef } from 'react';
import { format } from 'date-fns';
import { logAdminAction } from '@/lib/audit';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { ManageRolesDialog, ROLE_OPTIONS, getRoleOption } from '@/components/admin/ManageRolesDialog';
import { AdminMessageDialog } from '@/components/admin/AdminMessageDialog';
import { AdminNotesPanel } from '@/components/admin/AdminNotesPanel';
import { CountryPicker } from '@/components/admin/CountryPicker';
import { applyDialCode, enforceDialCodePrefix, findCountryByName, type Country } from '@/lib/countries';
import {
  Users, Home, Search, Plus, ChevronRight, ArrowLeft, ShieldCheck,
  Fingerprint, Mail, Phone, MapPin, Calendar, Star, MessageSquare,
  DollarSign, Activity, AlertTriangle, Trash2, Ban, Pencil, Eye,
  UserCog, KeyRound, LogOut, RotateCcw, Download, Filter, MoreVertical,
  CheckCircle2, XCircle, Globe,
} from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';

type Profile = Database['public']['Tables']['profiles']['Row'];
type AppRole = Database['public']['Enums']['app_role'];
type Booking = Database['public']['Tables']['bookings']['Row'];
type Property = Database['public']['Tables']['properties']['Row'];
type Review = Database['public']['Tables']['reviews']['Row'];
type Message = Database['public']['Tables']['messages']['Row'];

// ─── Lifecycle states (mapped from profile flags) ────────────────────────
type LifecycleState = 'active' | 'pending' | 'suspended';

const STATE_META: Record<LifecycleState, { label: string; tone: string; dot: string }> = {
  active:    { label: 'Active',    tone: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30', dot: 'bg-emerald-500' },
  pending:   { label: 'Pending',   tone: 'bg-amber-500/10 text-amber-600 border-amber-500/30',     dot: 'bg-amber-500' },
  suspended: { label: 'Suspended', tone: 'bg-destructive/10 text-destructive border-destructive/30', dot: 'bg-destructive' },
};

function getLifecycleState(p: Profile): LifecycleState {
  if (p.is_suspended) return 'suspended';
  if (!p.is_verified) return 'pending';
  return 'active';
}

function getInitials(name?: string | null, email?: string | null): string {
  if (name) return name.split(' ').map((n) => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  if (email) return email.slice(0, 2).toUpperCase();
  return 'U';
}

function primaryRoleOf(roles: AppRole[]): AppRole {
  // Highest-priority role for display
  const priority: AppRole[] = ['admin', 'finance_officer', 'customer_care', 'moderator', 'operations', 'hr', 'marketing', 'host', 'guest'];
  for (const r of priority) if (roles.includes(r)) return r;
  return 'guest';
}

type IdGroup = 'staff' | 'host' | 'guest';
const STAFF_ROLES: AppRole[] = ['admin', 'customer_care', 'finance_officer', 'hr', 'moderator', 'operations', 'marketing'];

function idGroupOf(roles: AppRole[]): IdGroup {
  if (roles.some((r) => STAFF_ROLES.includes(r) || (r as string) === 'superadmin')) return 'staff';
  if (roles.includes('host')) return 'host';
  return 'guest';
}

/**
 * Build a stable, sequential member ID per role-group based on profile creation order.
 * Example: GST-000123, HST-000045, STF-000007.
 */
function buildMemberIdMap(
  profiles: Profile[],
  rolesByUser: Record<string, AppRole[]>,
  prefixes: {
    guest_id_prefix: string; guest_id_length: number;
    host_id_prefix: string;  host_id_length: number;
    staff_id_prefix: string; staff_id_length: number;
  },
): Record<string, string> {
  const sorted = [...profiles].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const counters: Record<IdGroup, number> = { guest: 0, host: 0, staff: 0 };
  const out: Record<string, string> = {};
  sorted.forEach((p) => {
    const grp = idGroupOf(rolesByUser[p.user_id] || ['guest']);
    counters[grp] += 1;
    const cfg =
      grp === 'staff'
        ? { prefix: prefixes.staff_id_prefix, length: prefixes.staff_id_length }
        : grp === 'host'
        ? { prefix: prefixes.host_id_prefix, length: prefixes.host_id_length }
        : { prefix: prefixes.guest_id_prefix, length: prefixes.guest_id_length };
    const padded = String(counters[grp]).padStart(Math.max(cfg.length, 1), '0');
    out[p.user_id] = `${cfg.prefix}-${padded}`;
  });
  return out;
}

export default function AdminUsers() {
  const { toast } = useToast();
  const { user: currentAuthUser, profile: currentAuthProfile } = useAuth();

  // ─── Data ───
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userRoles, setUserRoles] = useState<Record<string, AppRole[]>>({});
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ─── ID prefix settings (from Settings → User Management) ───
  const [idPrefixes, setIdPrefixes] = useState<{
    guest_id_prefix: string; guest_id_length: number;
    host_id_prefix: string;  host_id_length: number;
    staff_id_prefix: string; staff_id_length: number;
  }>({
    guest_id_prefix: 'GST', guest_id_length: 6,
    host_id_prefix:  'HST', host_id_length:  6,
    staff_id_prefix: 'STF', staff_id_length: 6,
  });

  // ─── UI state ───
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | AppRole>('all');
  const [stateFilter, setStateFilter] = useState<'all' | LifecycleState>('all');
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);

  // ─── Dialogs ───
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<Profile | null>(null);
  const [editForm, setEditForm] = useState({ full_name: '', phone: '', location: '', bio: '', paypal_email: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [suspendUser, setSuspendUser] = useState<Profile | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [deleteUserDlg, setDeleteUserDlg] = useState<Profile | null>(null);
  const [rolesUser, setRolesUser] = useState<Profile | null>(null);
  const [messageUser, setMessageUser] = useState<Profile | null>(null);
  const [editCountry, setEditCountry] = useState<Country | null>(null);
  const phoneInputRef = useRef<HTMLInputElement | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    const [pRes, rRes, bRes, prRes, revRes, msgRes, auditRes, settingsRes] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('user_roles').select('*'),
      supabase.from('bookings').select('*'),
      supabase.from('properties').select('*'),
      supabase.from('reviews').select('*'),
      supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('audit_logs' as any).select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('platform_settings' as any).select('guest_id_prefix,guest_id_length,host_id_prefix,host_id_length,staff_id_prefix,staff_id_length').limit(1).maybeSingle(),
    ]);
    if (pRes.data) setProfiles(pRes.data);
    if (rRes.data) {
      const map: Record<string, AppRole[]> = {};
      rRes.data.forEach((r: any) => {
        if (!map[r.user_id]) map[r.user_id] = [];
        map[r.user_id].push(r.role);
      });
      setUserRoles(map);
    }
    if (bRes.data) setBookings(bRes.data);
    if (prRes.data) setProperties(prRes.data);
    if (revRes.data) setReviews(revRes.data);
    if (msgRes.data) setMessages(msgRes.data);
    if (auditRes.data) setAuditLog(auditRes.data as any[]);
    if (settingsRes?.data) {
      const s = settingsRes.data as any;
      setIdPrefixes({
        guest_id_prefix: s.guest_id_prefix ?? 'GST', guest_id_length: s.guest_id_length ?? 6,
        host_id_prefix:  s.host_id_prefix  ?? 'HST', host_id_length:  s.host_id_length  ?? 6,
        staff_id_prefix: s.staff_id_prefix ?? 'STF', staff_id_length: s.staff_id_length ?? 6,
      });
    }
    setIsLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  // ─── Derived: filtered list ───
  const filtered = useMemo(() => {
    return profiles.filter((p) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !(p.full_name || '').toLowerCase().includes(q) &&
          !p.email.toLowerCase().includes(q) &&
          !p.user_id.toLowerCase().includes(q)
        ) return false;
      }
      if (roleFilter !== 'all') {
        const roles = userRoles[p.user_id] || ['guest'];
        if (!roles.includes(roleFilter)) return false;
      }
      if (stateFilter !== 'all' && getLifecycleState(p) !== stateFilter) return false;
      return true;
    });
  }, [profiles, userRoles, search, roleFilter, stateFilter]);

  // ─── Stats ───
  const stats = useMemo(() => {
    const total = profiles.length;
    const active = profiles.filter((p) => getLifecycleState(p) === 'active').length;
    const pending = profiles.filter((p) => getLifecycleState(p) === 'pending').length;
    const suspended = profiles.filter((p) => p.is_suspended).length;
    const hosts = profiles.filter((p) => (userRoles[p.user_id] || []).includes('host') || p.is_host).length;
    const staffRoles: AppRole[] = ['admin', 'customer_care', 'finance_officer', 'hr', 'moderator', 'operations', 'marketing'];
    const staff = profiles.filter((p) => (userRoles[p.user_id] || []).some((r) => staffRoles.includes(r))).length;
    return { total, active, pending, suspended, hosts, staff };
  }, [profiles, userRoles]);

  // ─── Member-ID map (sequential per role-group, derived from creation order) ───
  const memberIds = useMemo(
    () => buildMemberIdMap(profiles, userRoles, idPrefixes),
    [profiles, userRoles, idPrefixes],
  );

  // ─── Per-user stats for detail view ───
  const getUserStats = (userId: string) => {
    const userBookings = bookings.filter((b) => b.guest_id === userId || b.host_id === userId);
    const userProperties = properties.filter((p) => p.host_id === userId);
    const userReviewsGiven = reviews.filter((r) => r.guest_id === userId);
    const userReviewsReceived = reviews.filter((r) => r.host_id === userId);
    const userMessages = messages.filter((m) => m.sender_id === userId || m.receiver_id === userId);
    const totalSpent = bookings.filter((b) => b.guest_id === userId && b.status === 'completed').reduce((s, b) => s + Number(b.total_price), 0);
    const totalEarned = bookings.filter((b) => b.host_id === userId && b.status === 'completed').reduce((s, b) => s + Number(b.total_price), 0);
    const hostBookings = bookings.filter((b) => b.host_id === userId);
    const hostConverted = hostBookings.filter((b) => b.status === 'completed' || b.status === 'confirmed');
    const hostConversionRate = hostBookings.length > 0 ? Math.round((hostConverted.length / hostBookings.length) * 100) : 0;
    const avgRatingReceived = userReviewsReceived.length > 0
      ? userReviewsReceived.reduce((s, r) => s + Number(r.overall_rating || 0), 0) / userReviewsReceived.length
      : 0;

    type Item = { type: 'booking' | 'review' | 'message'; date: string; description: string };
    const activity: Item[] = [];
    userBookings.forEach((b) => activity.push({
      type: 'booking', date: b.created_at,
      description: `Booking #${b.id.slice(0, 8)} — ${b.status} ($${Number(b.total_price).toLocaleString()})`,
    }));
    userReviewsGiven.forEach((r) => activity.push({
      type: 'review', date: r.created_at,
      description: `Left ${r.overall_rating}★${r.comment ? `: "${r.comment.slice(0, 50)}…"` : ''}`,
    }));
    userReviewsReceived.forEach((r) => activity.push({
      type: 'review', date: r.created_at,
      description: `Received ${r.overall_rating}★${r.comment ? `: "${r.comment.slice(0, 50)}…"` : ''}`,
    }));
    userMessages.slice(0, 25).forEach((m) => activity.push({
      type: 'message', date: m.created_at,
      description: `${m.sender_id === userId ? 'Sent' : 'Received'}: "${m.content.slice(0, 50)}${m.content.length > 50 ? '…' : ''}"`,
    }));
    activity.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return {
      bookings: userBookings.length, properties: userProperties.length,
      reviews: userReviewsGiven.length, messages: userMessages.length,
      totalSpent, totalEarned, hostConversionRate,
      hostBookingsTotal: hostBookings.length, hostBookingsConverted: hostConverted.length,
      avgRatingReceived, totalReviewsReceived: userReviewsReceived.length,
      activity: activity.slice(0, 15),
    };
  };

  // ─── Mutations ───
  const updateLifecycle = async (p: Profile, newState: LifecycleState, reason?: string) => {
    const updates: Partial<Profile> = {};
    if (newState === 'suspended') {
      Object.assign(updates, { is_suspended: true, suspended_reason: reason || null, suspended_at: new Date().toISOString() } as any);
    } else if (newState === 'active') {
      Object.assign(updates, { is_suspended: false, suspended_reason: null, suspended_at: null, is_verified: true } as any);
    } else if (newState === 'pending') {
      Object.assign(updates, { is_suspended: false, suspended_reason: null, suspended_at: null, is_verified: false } as any);
    }
    const { error } = await supabase.from('profiles').update(updates).eq('user_id', p.user_id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    await logAdminAction(`user.${newState}`, 'user', p.user_id, { reason });
    toast({ title: 'State updated', description: `${p.full_name || p.email} → ${STATE_META[newState].label}` });
    fetchData();
    if (selectedUser?.user_id === p.user_id) {
      setSelectedUser({ ...p, ...updates } as Profile);
    }
  };

  const handleDelete = async () => {
    if (!deleteUserDlg) return;
    const { error } = await supabase.from('profiles').delete().eq('user_id', deleteUserDlg.user_id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    await logAdminAction('user.delete', 'user', deleteUserDlg.user_id, { name: deleteUserDlg.full_name });
    toast({ title: 'User deleted', description: `${deleteUserDlg.full_name || deleteUserDlg.email} permanently removed` });
    setDeleteUserDlg(null);
    setSelectedUser(null);
    fetchData();
  };

  const handleSaveEdit = async () => {
    if (!editUser) return;
    setIsSaving(true);
    const { error } = await supabase.from('profiles').update({
      full_name: editForm.full_name, phone: editForm.phone, location: editForm.location,
      bio: editForm.bio, paypal_email: editForm.paypal_email,
    }).eq('user_id', editUser.user_id);
    if (!error) {
      await logAdminAction('user.edit_profile', 'user', editUser.user_id, { changes: editForm });
      toast({ title: 'Profile updated' });
      setEditUser(null);
      fetchData();
    } else {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
    setIsSaving(false);
  };

  const openEdit = (p: Profile) => {
    setEditUser(p);
    setEditForm({
      full_name: p.full_name || '', phone: p.phone || '', location: p.location || '',
      bio: p.bio || '', paypal_email: p.paypal_email || '',
    });
    setEditCountry(findCountryByName(p.location) ?? null);
  };

  const handleSuspendDialog = async () => {
    if (!suspendUser) return;
    const target: LifecycleState = suspendUser.is_suspended ? 'active' : 'suspended';
    await updateLifecycle(suspendUser, target, suspendReason);
    setSuspendUser(null);
    setSuspendReason('');
  };

  // ─── Loading ───
  if (isLoading) {
    return (
      <AdminLayout>
        <div className="animate-pulse space-y-6">
          <div className="h-12 bg-muted rounded w-1/3" />
          <div className="grid grid-cols-6 gap-4">
            {[...Array(6)].map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl" />)}
          </div>
          <div className="h-96 bg-muted rounded-xl" />
        </div>
      </AdminLayout>
    );
  }

  // ─── Detail View ───
  if (selectedUser) {
    const liveProfile = profiles.find((p) => p.user_id === selectedUser.user_id) || selectedUser;
    return (
      <AdminLayout>
        <UserDetailView
          user={liveProfile}
          roles={userRoles[liveProfile.user_id] || []}
          stats={getUserStats(liveProfile.user_id)}
          auditLog={auditLog}
          memberId={memberIds[liveProfile.user_id] ?? '—'}
          onBack={() => setSelectedUser(null)}
          onEdit={() => openEdit(liveProfile)}
          onManageRoles={() => setRolesUser(liveProfile)}
          onMessage={() => setMessageUser(liveProfile)}
          onLifecycleChange={(state, reason) => updateLifecycle(liveProfile, state, reason)}
          onDelete={() => setDeleteUserDlg(liveProfile)}
          onSuspend={() => { setSuspendUser(liveProfile); setSuspendReason(''); }}
        />
        {/* Detail-view dialogs */}
        {renderDialogs()}
      </AdminLayout>
    );
  }

  function renderDialogs() {
    return (
      <>
        {/* Edit dialog */}
        <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle className="font-display">Edit profile</DialogTitle></DialogHeader>
            {editUser && (
              <div className="space-y-4">
                <div className="space-y-2"><Label>Full name</Label>
                  <Input value={editForm.full_name} onChange={(e) => setEditForm((f) => ({ ...f, full_name: e.target.value }))} /></div>
                <div className="space-y-2"><Label>Email</Label>
                  <Input value={editUser.email} disabled className="opacity-60" />
                  <p className="text-xs text-muted-foreground">Email cannot be changed</p></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label htmlFor="edit-phone">Phone</Label>
                    <Input
                      id="edit-phone"
                      ref={phoneInputRef}
                      value={editForm.phone}
                      onChange={(e) => {
                        const next = editCountry
                          ? enforceDialCodePrefix(e.target.value, editCountry.dial)
                          : e.target.value;
                        setEditForm((f) => ({ ...f, phone: next }));
                      }}
                      placeholder={editCountry ? `+${editCountry.dial} …` : '+code number'}
                      inputMode="tel"
                      autoComplete="tel"
                    />
                  </div>
                  <div className="space-y-2"><Label>Country</Label>
                    <CountryPicker
                      value={editCountry?.code ?? editForm.location}
                      onChange={(c) => {
                        setEditCountry(c);
                        const nextPhone = applyDialCode(editForm.phone, c.dial);
                        setEditForm((f) => ({
                          ...f,
                          location: c.name,
                          phone: nextPhone,
                        }));
                        // Place caret right after "+<dial> " so the user types the local number next
                        requestAnimationFrame(() => {
                          const input = phoneInputRef.current;
                          if (!input) return;
                          input.focus();
                          const pos = `+${c.dial} `.length;
                          input.setSelectionRange(pos, pos);
                        });
                      }}
                    />
                  </div>
                </div>
                <div className="space-y-2"><Label>PayPal email</Label>
                  <Input value={editForm.paypal_email} onChange={(e) => setEditForm((f) => ({ ...f, paypal_email: e.target.value }))} /></div>
                <div className="space-y-2"><Label>Bio</Label>
                  <Textarea rows={3} value={editForm.bio} onChange={(e) => setEditForm((f) => ({ ...f, bio: e.target.value }))} /></div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
                  <Button onClick={handleSaveEdit} disabled={isSaving}>{isSaving ? 'Saving…' : 'Save changes'}</Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Suspend dialog */}
        <Dialog open={!!suspendUser} onOpenChange={(open) => !open && setSuspendUser(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="font-display flex items-center gap-2">
                <Ban className="w-5 h-5" /> {suspendUser?.is_suspended ? 'Restore access' : 'Suspend account'}
              </DialogTitle>
            </DialogHeader>
            {suspendUser && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-sm font-semibold text-primary">{getInitials(suspendUser.full_name, suspendUser.email)}</span>
                  </div>
                  <div>
                    <p className="font-medium text-sm">{suspendUser.full_name || 'Unknown'}</p>
                    <p className="text-xs text-muted-foreground">{suspendUser.email}</p>
                  </div>
                </div>
                {!suspendUser.is_suspended ? (
                  <>
                    <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 text-sm text-destructive">
                      <AlertTriangle className="w-4 h-4 inline mr-1" /> The user will be unable to log in until restored.
                    </div>
                    <div className="space-y-2"><Label>Reason</Label>
                      <Textarea placeholder="Policy violation, suspicious activity…" value={suspendReason}
                        onChange={(e) => setSuspendReason(e.target.value)} rows={3} /></div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Restore full access for <strong>{suspendUser.full_name || suspendUser.email}</strong>?</p>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setSuspendUser(null)}>Cancel</Button>
                  <Button variant={suspendUser.is_suspended ? 'default' : 'destructive'} onClick={handleSuspendDialog}>
                    {suspendUser.is_suspended ? 'Restore access' : 'Suspend account'}
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Delete dialog */}
        <Dialog open={!!deleteUserDlg} onOpenChange={(open) => !open && setDeleteUserDlg(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="font-display flex items-center gap-2 text-destructive">
                <Trash2 className="w-5 h-5" /> Permanently delete account
              </DialogTitle>
            </DialogHeader>
            {deleteUserDlg && (
              <div className="space-y-4">
                <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 text-sm text-destructive">
                  <AlertTriangle className="w-4 h-4 inline mr-1" /> This executes a GDPR right-to-erasure. Cannot be undone.
                </div>
                <p className="text-sm text-muted-foreground">
                  Delete <strong>{deleteUserDlg.full_name || deleteUserDlg.email}</strong>? Anonymized booking records are retained for legal compliance.
                </p>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDeleteUserDlg(null)}>Cancel</Button>
                  <Button variant="destructive" onClick={handleDelete}>
                    <Trash2 className="w-4 h-4 mr-1" /> Delete permanently
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <ManageRolesDialog
          userId={rolesUser?.user_id ?? null}
          userName={rolesUser?.full_name ?? rolesUser?.email}
          currentRoles={rolesUser ? (userRoles[rolesUser.user_id] || []) : []}
          onClose={() => setRolesUser(null)}
          onSaved={fetchData}
        />

        <AdminMessageDialog
          open={!!messageUser}
          onClose={() => setMessageUser(null)}
          recipientId={messageUser?.user_id ?? null}
          recipientName={messageUser?.full_name ?? messageUser?.email ?? 'user'}
        />
      </>
    );
  }

  // ─── Directory View ───
  return (
    <AdminLayout>
      {/* HERO */}
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
          Identity Directory · {format(new Date(), 'EEEE, MMMM d')}
        </p>
        <h1 className="font-display text-4xl md:text-5xl font-bold leading-tight tracking-tight">
          Every account, every role, <span className="text-primary">one view.</span>
        </h1>
        <p className="text-muted-foreground mt-2 text-sm max-w-2xl">
          Live directory of all platform identities — guests, hosts, and staff. Every action is recorded in the audit log.
        </p>
      </div>

      {/* STAT STRIP */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {[
          { label: 'Total users', value: stats.total, color: 'text-foreground' },
          { label: 'Active', value: stats.active, color: 'text-emerald-600' },
          { label: 'Pending verification', value: stats.pending, color: 'text-amber-600' },
          { label: 'Suspended', value: stats.suspended, color: 'text-destructive' },
          { label: 'Hosts', value: stats.hosts, color: 'text-primary' },
          { label: 'Staff accounts', value: stats.staff, color: 'text-purple-600' },
        ].map((s) => (
          <Card key={s.label} className="card-luxury">
            <CardContent className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{s.label}</p>
              <p className={`font-display text-3xl font-bold ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* FILTERS */}
      <div className="flex flex-col md:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or user ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-11"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as any)}
          className="h-11 px-4 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring min-w-[160px]"
        >
          <option value="all">All roles</option>
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value as any)}
          className="h-11 px-4 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring min-w-[160px]"
        >
          <option value="all">All states</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="suspended">Suspended</option>
        </select>
        <Button variant="outline" className="h-11 gap-2" onClick={fetchData}>
          <RotateCcw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {profiles.length} accounts
      </p>

      {/* DIRECTORY TABLE */}
      <Card className="card-luxury overflow-hidden">
        {/* Header row */}
        <div className="hidden md:grid grid-cols-[2.4fr_1.2fr_1fr_1.1fr_1fr_40px] gap-4 px-5 py-3 border-b bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          <div>User</div>
          <div>Role</div>
          <div>State</div>
          <div>Verification</div>
          <div>Joined</div>
          <div></div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No users match your filters</p>
          </div>
        ) : (
          filtered.map((p) => {
            const roles = userRoles[p.user_id] || ['guest' as AppRole];
            const primary = primaryRoleOf(roles);
            const opt = getRoleOption(primary);
            const RoleIcon = opt?.icon ?? Users;
            const lifecycle = getLifecycleState(p);
            const stateMeta = STATE_META[lifecycle];
            const isSelf = p.user_id === currentAuthUser?.id;

            return (
              <button
                key={p.id}
                onClick={() => setSelectedUser(p)}
                className="w-full grid grid-cols-1 md:grid-cols-[2.4fr_1.2fr_1fr_1.1fr_1fr_40px] gap-4 px-5 py-4 border-b last:border-b-0 text-left hover:bg-muted/40 transition-colors items-center group"
              >
                {/* User */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden">
                    {p.avatar_url ? (
                      <img src={p.avatar_url} alt="" className="w-10 h-10 object-cover" />
                    ) : (
                      <span className="text-xs font-semibold text-primary">{getInitials(p.full_name, p.email)}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{p.full_name || 'Unnamed user'}</p>
                      {isSelf && <Badge variant="outline" className="text-[9px] py-0 px-1.5">YOU</Badge>}
                    </div>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">{p.email}</p>
                  </div>
                </div>

                {/* Role */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant="outline" className={opt?.badgeClass ?? 'bg-muted text-muted-foreground border-border'}>
                    <RoleIcon className="w-3 h-3 mr-1" />
                    {opt?.label ?? primary}
                  </Badge>
                  {roles.length > 1 && (
                    <span className="text-[10px] text-muted-foreground">+{roles.length - 1}</span>
                  )}
                </div>

                {/* State */}
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${stateMeta.dot}`} />
                  <span className="text-xs font-medium">{stateMeta.label}</span>
                </div>

                {/* Verification */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {p.is_verified ? (
                    <><ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> <span>ID Verified</span></>
                  ) : (
                    <><ShieldCheck className="w-3.5 h-3.5 opacity-30" /> <span>Email only</span></>
                  )}
                  {p.phone && <Fingerprint className="w-3 h-3 text-cyan-600" aria-label="Phone on file" />}
                </div>

                {/* Joined */}
                <div className="text-xs text-muted-foreground">
                  {format(new Date(p.created_at), 'MMM d, yyyy')}
                </div>

                {/* Chevron */}
                <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity justify-self-end" />
              </button>
            );
          })
        )}
      </Card>

      {renderDialogs()}
    </AdminLayout>
  );
}

// ════════════════════════════════════════════════════════════════════════
// USER DETAIL VIEW
// ════════════════════════════════════════════════════════════════════════

interface UserDetailProps {
  user: Profile;
  roles: AppRole[];
  stats: UserStats;
  auditLog: any[];
  memberId: string;
  onBack: () => void;
  onEdit: () => void;
  onManageRoles: () => void;
  onMessage: () => void;
  onLifecycleChange: (state: LifecycleState, reason?: string) => void;
  onDelete: () => void;
  onSuspend: () => void;
}

type UserStats = {
  bookings: number; properties: number; reviews: number; messages: number;
  totalSpent: number; totalEarned: number; hostConversionRate: number;
  hostBookingsTotal: number; hostBookingsConverted: number;
  avgRatingReceived: number; totalReviewsReceived: number;
  activity: { type: 'booking' | 'review' | 'message'; date: string; description: string }[];
};

function UserDetailView({ user, roles, stats, auditLog, memberId, onBack, onEdit, onManageRoles, onMessage, onLifecycleChange, onDelete, onSuspend }: UserDetailProps) {
  const [reason, setReason] = useState('');
  const [pendingState, setPendingState] = useState<typeof EXTENDED_STATES[number] | null>(null);
  const lifecycle = getLifecycleState(user);
  const primary = primaryRoleOf(roles);
  const opt = getRoleOption(primary);
  const RoleIcon = opt?.icon ?? Users;
  const userAudit = auditLog.filter((l) => l.entity_id === user.user_id).slice(0, 12);

  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to directory
      </button>

      {/* HEADER CARD */}
      <Card className="card-luxury mb-6">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-start gap-5">
            {/* Avatar */}
            <div className={`w-20 h-20 rounded-full flex items-center justify-center shrink-0 overflow-hidden ${roleAvatarBg(primary)}`}>
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className="w-20 h-20 object-cover" />
              ) : (
                <span className="font-display text-2xl font-bold text-white drop-shadow-sm">{getInitials(user.full_name, user.email)}</span>
              )}
            </div>

            {/* Identity */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                <h1 className="font-display text-3xl font-bold">{user.full_name || 'Unnamed user'}</h1>
                <Badge variant="outline" className={STATE_META[lifecycle].tone}>
                  {STATE_META[lifecycle].label}
                </Badge>
                <Badge variant="outline" className="font-mono bg-primary/5 text-primary border-primary/30">
                  {memberId}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground font-mono mb-3">
                <span className="font-semibold text-foreground/80">Member ID:</span> {memberId}
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> {user.email}</span>
                {user.phone && <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> {user.phone}</span>}
                {user.location && <span className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> {user.location}</span>}
                <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Joined {format(new Date(user.created_at), 'MMM yyyy')}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Eye className="w-3.5 h-3.5 mr-1.5" /> Impersonate
              </Button>
              <Button variant="outline" size="sm" onClick={onMessage}>
                <Mail className="w-3.5 h-3.5 mr-1.5" /> Message
              </Button>
            </div>
          </div>

          {/* Attribute grid */}
          <Separator className="my-5" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Role', value: opt?.label ?? primary, icon: RoleIcon, tone: roleIconColor(primary) },
              { label: 'Verification', value: user.is_verified ? 'Tier 2 — ID Verified' : 'Tier 0 — Email', icon: ShieldCheck, tone: user.is_verified ? 'text-emerald-500' : 'text-muted-foreground' },
              { label: 'MFA', value: user.phone ? 'Enabled' : 'Disabled', icon: Fingerprint, tone: user.phone ? 'text-emerald-500' : 'text-destructive' },
              { label: user.is_host ? 'Listings' : 'Bookings', value: user.is_host ? stats.properties : stats.bookings, icon: user.is_host ? Home : Calendar, tone: 'text-primary' },
            ].map((attr) => {
              const Icon = attr.icon;
              return (
                <div key={attr.label} className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{attr.label}</p>
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${attr.tone ?? 'text-primary'}`} />
                    <span className="font-semibold text-sm">{attr.value}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* MAIN GRID */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* LEFT: Actions panel */}
        <Card className="card-luxury">
          <CardContent className="p-6 space-y-6">
            <div>
              <h2 className="font-display text-lg font-bold">Account actions</h2>
              <p className="text-xs text-muted-foreground">All actions are recorded in the audit log</p>
            </div>

            {/* Lifecycle controls — 3×2 grid */}
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Lifecycle state</Label>
              <div className="grid grid-cols-3 gap-2">
                {EXTENDED_STATES.map((s) => {
                  const isCurrent = s.matchesCurrent(user);
                  return (
                    <button
                      key={s.key}
                      disabled={isCurrent}
                      onClick={() => setPendingState(s)}
                      className={`px-3 py-2.5 rounded-lg border text-xs font-semibold transition-all ${
                        isCurrent
                          ? `${s.activeTone} cursor-not-allowed`
                          : 'bg-background hover:bg-muted/50 border-border text-foreground'
                      }`}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label htmlFor="reason" className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Reason (optional)</Label>
              <Input
                id="reason"
                placeholder="e.g. Multiple policy violations"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            {/* Quick actions — 2×2 grid */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button variant="outline" size="sm" className="justify-center h-10" disabled>
                <KeyRound className="w-3.5 h-3.5 mr-2" /> Force password reset
              </Button>
              <Button variant="outline" size="sm" className="justify-center h-10" disabled>
                <LogOut className="w-3.5 h-3.5 mr-2" /> Revoke all sessions
              </Button>
              <Button variant="outline" size="sm" className="justify-center h-10" disabled>
                <Download className="w-3.5 h-3.5 mr-2" /> Export data (GDPR)
              </Button>
              <Button variant="outline" size="sm" className="justify-center h-10" disabled>
                <ShieldCheck className="w-3.5 h-3.5 mr-2" /> Re-verify identity
              </Button>
            </div>

            <Separator />

            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onEdit}>
                  <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit profile
                </Button>
                <Button variant="outline" size="sm" onClick={onManageRoles}>
                  <UserCog className="w-3.5 h-3.5 mr-1.5" /> Manage roles
                </Button>
              </div>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={onDelete}>
                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* RIGHT: Internal notes + Recent activity */}
        <div className="space-y-6">
          {/* Internal notes */}
          <Card className="card-luxury">
            <CardContent className="p-5">
              <h3 className="font-display text-lg font-bold">Internal notes</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Visible only to staff. Each note can only be edited or deleted by its original author.
              </p>
              <AdminNotesPanel targetUserId={user.user_id} />
              {user.is_suspended && user.suspended_reason && (
                <div className="mt-3 p-3 rounded-lg border border-destructive/30 bg-destructive/5">
                  <div className="flex items-center gap-2 text-destructive font-semibold text-xs mb-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Suspended
                  </div>
                  <p className="text-xs text-muted-foreground">{user.suspended_reason}</p>
                  {user.suspended_at && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Since {format(new Date(user.suspended_at), 'MMM d, yyyy')}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent activity */}
          <Card className="card-luxury">
            <CardContent className="p-5">
              <h3 className="font-display text-lg font-bold mb-4">Recent activity</h3>
              {stats.activity.length === 0 && userAudit.length === 0 ? (
                <p className="text-xs text-muted-foreground py-8 text-center">No recorded events</p>
              ) : (
                <div className="space-y-4 max-h-80 overflow-y-auto pr-1">
                  {userAudit.map((entry: any) => (
                    <ActivityRow
                      key={entry.id}
                      tone={severityToTone(entry.action)}
                      label={entry.action}
                      detail={renderAuditDetail(entry)}
                      date={entry.created_at}
                    />
                  ))}
                  {stats.activity.map((item, i) => (
                    <ActivityRow
                      key={`act-${i}`}
                      tone={item.type === 'booking' ? 'cyan' : item.type === 'review' ? 'amber' : 'emerald'}
                      label={`${item.type}.event`}
                      detail={item.description}
                      date={item.date}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={!!pendingState} onOpenChange={(open) => !open && setPendingState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Change state to "{pendingState?.label}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately affect the user's access. A reason will be recorded in the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-500 hover:bg-amber-600 text-white"
              onClick={() => {
                if (pendingState) {
                  onLifecycleChange(pendingState.lifecycle, reason || pendingState.label);
                }
                setPendingState(null);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Helpers ───

function roleAvatarBg(role: AppRole): string {
  switch (role) {
    case 'admin': return 'bg-red-500';
    case 'host': return 'bg-emerald-500';
    case 'guest': return 'bg-slate-400';
    case 'customer_care': return 'bg-purple-500';
    case 'finance_officer': return 'bg-amber-500';
    case 'hr': return 'bg-pink-500';
    case 'moderator': return 'bg-blue-500';
    case 'operations': return 'bg-slate-500';
    case 'marketing': return 'bg-rose-500';
    default: return 'bg-muted';
  }
}

function roleIconColor(role: AppRole): string {
  switch (role) {
    case 'admin': return 'text-red-500';
    case 'host': return 'text-emerald-500';
    case 'guest': return 'text-slate-400';
    case 'customer_care': return 'text-purple-500';
    case 'finance_officer': return 'text-amber-500';
    case 'hr': return 'text-pink-500';
    case 'moderator': return 'text-blue-500';
    case 'operations': return 'text-slate-500';
    case 'marketing': return 'text-rose-500';
    default: return 'text-muted-foreground';
  }
}

const EXTENDED_STATES: {
  key: string;
  label: string;
  lifecycle: LifecycleState;
  matchesCurrent: (p: Profile) => boolean;
  activeTone: string;
}[] = [
  {
    key: 'pending', label: 'Pending', lifecycle: 'pending',
    matchesCurrent: (p) => !p.is_suspended && !p.is_verified,
    activeTone: 'bg-amber-500/15 text-amber-600 border-amber-500/40',
  },
  {
    key: 'active', label: 'Active', lifecycle: 'active',
    matchesCurrent: (p) => !p.is_suspended && !!p.is_verified,
    activeTone: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/40',
  },
  {
    key: 'restricted', label: 'Restricted', lifecycle: 'suspended',
    matchesCurrent: (p) => !!p.is_suspended && (p.suspended_reason || '').toLowerCase().includes('restrict'),
    activeTone: 'bg-orange-500/15 text-orange-600 border-orange-500/40',
  },
  {
    key: 'suspended', label: 'Suspended', lifecycle: 'suspended',
    matchesCurrent: (p) => {
      if (!p.is_suspended) return false;
      const r = (p.suspended_reason || '').toLowerCase();
      return !r.includes('restrict') && !r.includes('ban') && !r.includes('deactiv');
    },
    activeTone: 'bg-destructive/15 text-destructive border-destructive/40',
  },
  {
    key: 'banned', label: 'Banned', lifecycle: 'suspended',
    matchesCurrent: (p) => !!p.is_suspended && (p.suspended_reason || '').toLowerCase().includes('ban'),
    activeTone: 'bg-red-700/20 text-red-600 border-red-600/40',
  },
  {
    key: 'deactivated', label: 'Deactivated', lifecycle: 'suspended',
    matchesCurrent: (p) => !!p.is_suspended && (p.suspended_reason || '').toLowerCase().includes('deactiv'),
    activeTone: 'bg-muted text-muted-foreground border-border',
  },
];

function severityToTone(action: string): 'cyan' | 'amber' | 'emerald' | 'rose' {
  if (action.includes('delete') || action.includes('suspend') || action.includes('ban')) return 'rose';
  if (action.includes('refund') || action.includes('payout')) return 'amber';
  if (action.includes('login') || action.includes('register')) return 'cyan';
  return 'emerald';
}

function renderAuditDetail(entry: any): string {
  if (entry.details && typeof entry.details === 'object' && Object.keys(entry.details).length > 0) {
    return Object.entries(entry.details)
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' · ');
  }
  return entry.entity_type ? `${entry.entity_type} event` : 'event';
}

function ActivityRow({ tone, label, detail, date }: { tone: 'cyan' | 'amber' | 'emerald' | 'rose'; label: string; detail: string; date: string }) {
  const dotClass = { cyan: 'bg-cyan-500', amber: 'bg-amber-500', emerald: 'bg-emerald-500', rose: 'bg-rose-500' }[tone];
  const labelClass = { cyan: 'text-cyan-500', amber: 'text-amber-500', emerald: 'text-emerald-500', rose: 'text-rose-500' }[tone];
  return (
    <div className="flex items-start gap-3">
      <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotClass}`} />
      <div className="flex-1 min-w-0">
        <p className={`font-mono text-xs font-semibold ${labelClass}`}>{label}</p>
        <p className="text-xs text-foreground/80 mt-1 break-words">
          <span className={`font-mono ${labelClass}`}>{label}</span>
          <span className="text-muted-foreground"> · </span>
          {detail}
        </p>
        <p className="text-[10px] text-muted-foreground mt-1">
          {format(new Date(date), 'M/d/yyyy, h:mm:ss a')}
        </p>
      </div>
    </div>
  );
}