import { useState, useEffect, useMemo } from 'react';
import { logAdminAction } from '@/lib/audit';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Home, Search, MoreHorizontal, Check, X, Eye, Star, CheckSquare, RotateCcw, Trash2,
  AlertTriangle, Edit, DollarSign, Calendar, Users, MapPin, Bed, Bath, Download,
  Shield, ToggleLeft, ToggleRight, Image as ImageIcon, MessageSquare, Camera, Flag, ArrowLeft,
  ShieldCheck, FileCheck, FileText, Ban, UserCircle
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AdminMessageDialog } from '@/components/admin/AdminMessageDialog';
import { format } from 'date-fns';
import type { Database } from '@/integrations/supabase/types';
import { buildPropertyIdentifierMap } from '@/lib/propertyIdentifier';

type Property = Database['public']['Tables']['properties']['Row'];
type Profile = Database['public']['Tables']['profiles']['Row'];
type Booking = Database['public']['Tables']['bookings']['Row'];
type Review = Database['public']['Tables']['reviews']['Row'];

type StatusEnum = Database['public']['Enums']['property_status'];

export default function AdminProperties() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [properties, setProperties] = useState<Property[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ action: string; count: number } | null>(null);
  const [detailProperty, setDetailProperty] = useState<Property | null>(null);
  const [editProperty, setEditProperty] = useState<Property | null>(null);
  const [editForm, setEditForm] = useState<Partial<Property>>({});
  const [statusConfirm, setStatusConfirm] = useState<{
    propertyId: string;
    newStatus: StatusEnum;
    label: string;
    description: string;
    impact: string;
  } | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [bulkReason, setBulkReason] = useState('');
  const [bulkConfirm, setBulkConfirm] = useState<{
    action: StatusEnum | 'delete';
    label: string;
    impact: string;
    count: number;
  } | null>(null);
  const [messageHost, setMessageHost] = useState<{ id: string; name: string } | null>(null);
  // Compliance checklist persisted per-property in localStorage (admin review aid).
  const COMPLIANCE_KEYS = ['host_id_verified', 'tax_form', 'insurance', 'str_license'] as const;
  type ComplianceKey = typeof COMPLIANCE_KEYS[number];
  const [compliance, setCompliance] = useState<Record<string, Record<ComplianceKey, boolean>>>(() => {
    try {
      const raw = localStorage.getItem('admin_property_compliance');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const setComplianceFlag = (propertyId: string, key: ComplianceKey, value: boolean) => {
    setCompliance(prev => {
      const next = {
        ...prev,
        [propertyId]: { ...(prev[propertyId] || {} as Record<ComplianceKey, boolean>), [key]: value },
      };
      try { localStorage.setItem('admin_property_compliance', JSON.stringify(next)); } catch {}
      logAdminAction('compliance_update', 'property', propertyId, { key, value });
      return next;
    });
  };

  const fetchData = async () => {
    setIsLoading(true);
    const [p, pr, b, r] = await Promise.all([
      supabase.from('properties').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('*'),
      supabase.from('bookings').select('*'),
      supabase.from('reviews').select('*'),
    ]);
    if (p.data) setProperties(p.data);
    if (pr.data) setProfiles(pr.data);
    if (b.data) setBookings(b.data);
    if (r.data) setReviews(r.data);
    setIsLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const updatePropertyStatus = async (id: string, status: StatusEnum, reason?: string) => {
    const { error } = await supabase.from('properties').update({ status }).eq('id', id);
    if (!error) {
      const actionMap: Record<string, string> = { active: 'approve', rejected: 'reject', inactive: 'deactivate', draft: 'reset_to_draft', suspended: 'suspend' };
      await logAdminAction(actionMap[status] || 'update_status', 'property', id, {
        new_status: status,
        reason: reason || null,
      });
      toast({ title: 'Success', description: `Property status updated to ${status}` }); fetchData();
    }
  };

  const deleteProperty = async (id: string) => {
    const { error } = await supabase.from('properties').delete().eq('id', id);
    if (!error) {
      await logAdminAction('delete', 'property', id);
      toast({ title: 'Deleted', description: 'Property permanently deleted' }); fetchData();
    } else {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const savePropertyEdit = async () => {
    if (!editProperty) return;
    const { error } = await supabase.from('properties').update(editForm).eq('id', editProperty.id);
    if (!error) {
      await logAdminAction('edit', 'property', editProperty.id, { changes: editForm });
      toast({ title: 'Saved', description: 'Property updated successfully' });
      setEditProperty(null); setEditForm({}); fetchData();
    } else {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const getHost = (hostId: string) => profiles.find(p => p.user_id === hostId);

  const filtered = useMemo(() => {
    let result = properties;
    if (propertyFilter !== 'all') result = result.filter(p => p.status === propertyFilter);
    if (typeFilter !== 'all') result = result.filter(p => p.property_type === typeFilter);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      result = result.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.city.toLowerCase().includes(q) ||
        p.country.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        (getHost(p.host_id)?.full_name || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [properties, propertyFilter, typeFilter, searchTerm, profiles]);

  const toggleSelect = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = () => setSelectedIds(prev => prev.size === filtered.length ? new Set() : new Set(filtered.map(p => p.id)));

  const bulkAction = async (action: string) => {
    setIsBulkProcessing(true);
    for (const id of selectedIds) {
      if (action === 'delete') {
        await supabase.from('properties').delete().eq('id', id);
        await logAdminAction('bulk_delete', 'property', id);
      } else {
        await supabase.from('properties').update({ status: action as any }).eq('id', id);
        await logAdminAction(`bulk_${action}`, 'property', id);
      }
    }
    toast({ title: 'Success', description: `${selectedIds.size} properties ${action === 'delete' ? 'deleted' : 'updated to ' + action}` });
    setSelectedIds(new Set()); setIsBulkProcessing(false); setConfirmDialog(null); fetchData();
  };

  const exportCSV = () => {
    const rows = [
      ['ID', 'Title', 'Type', 'Status', 'Host', 'City', 'Country', 'Price/Night', 'Bedrooms', 'Beds', 'Bathrooms', 'Max Guests', 'Rating', 'Total Reviews', 'Total Bookings', 'Created'],
      ...filtered.map(p => [
        p.id, p.title, p.property_type, p.status, getHost(p.host_id)?.full_name || 'Unknown',
        p.city, p.country, p.price_per_night, p.bedrooms, p.beds, p.bathrooms, p.max_guests,
        Number(p.average_rating).toFixed(1), p.total_reviews, p.total_bookings, format(new Date(p.created_at), 'yyyy-MM-dd'),
      ])
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `properties_export_${format(new Date(), 'yyyy-MM-dd')}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Exported', description: `${filtered.length} properties exported to CSV` });
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      active: 'bg-green-500/10 text-green-500 border-green-500/30',
      pending_approval: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
      draft: 'bg-muted text-muted-foreground border-border',
      inactive: 'bg-slate-500/10 text-slate-500 border-slate-500/30',
      rejected: 'bg-destructive/10 text-destructive border-destructive/30',
      suspended: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
    };
    return <Badge className={map[status] || map.draft}>{status.replace('_', ' ')}</Badge>;
  };

  const statusCounts = useMemo(() => ({
    all: properties.length,
    active: properties.filter(p => p.status === 'active').length,
    pending_approval: properties.filter(p => p.status === 'pending_approval').length,
    draft: properties.filter(p => p.status === 'draft').length,
    inactive: properties.filter(p => p.status === 'inactive').length,
    rejected: properties.filter(p => p.status === 'rejected').length,
    suspended: properties.filter(p => (p.status as string) === 'suspended').length,
  }), [properties]);

  const propertyTypes = [...new Set(properties.map(p => p.property_type))];

  // Stable per-host sequential identifier (L_001, L_002, …) based on listing order.
  const propertyIdMap = useMemo(() => buildPropertyIdentifierMap(properties), [properties]);
  const shortIdFor = (p: Property) => propertyIdMap.get(p.id) ?? `L_${p.id.slice(0, 3).toUpperCase()}`;

  const statusLabels: Record<string, string> = {
    active: 'Active',
    inactive: 'Paused',
    rejected: 'Rejected',
    pending_approval: 'Pending Review',
    draft: 'Draft',
    suspended: 'Suspended',
  };

  const statusDescriptions: Record<string, string> = {
    active: 'Live and bookable',
    inactive: 'Paused — hidden from search',
    rejected: 'Rejected — host will be notified',
    pending_approval: 'Returned to review queue',
    draft: 'Reset to draft — host can edit',
    suspended: 'Suspended by admin — listing is locked',
  };

  const statusImpacts: Record<string, string> = {
    active: 'New guests will see this listing in search and can book it.',
    inactive: 'Hidden from search and unbookable. Existing guests keep messaging access.',
    rejected: 'Removed from search and unbookable. Existing guests keep messaging access.',
    pending_approval: 'Sent back to the review queue. Hidden from search until approved.',
    draft: 'Hidden from search and unbookable. Host can edit and resubmit.',
    suspended: 'Listing is locked and hidden from search. Host cannot accept new bookings; existing guests keep messaging access.',
  };

  const requestStatusChange = (propertyId: string, newStatus: StatusEnum) => {
    setStatusReason('');
    setStatusConfirm({
      propertyId,
      newStatus,
      label: statusLabels[newStatus] || newStatus,
      description: statusDescriptions[newStatus] || `Change status to ${newStatus}`,
      impact: statusImpacts[newStatus] || '',
    });
  };

  const confirmStatusChange = async () => {
    if (!statusConfirm) return;
    const reason = statusReason.trim();
    if (reason.length < 5) return;
    await updatePropertyStatus(statusConfirm.propertyId, statusConfirm.newStatus, reason);
    setStatusConfirm(null);
    setStatusReason('');
  };

  const requestBulkAction = (action: StatusEnum | 'delete') => {
    const labels: Record<string, string> = {
      active: 'Approve & publish',
      inactive: 'Pause (deactivate)',
      draft: 'Reset to draft',
      rejected: 'Reject',
      pending_approval: 'Send to review',
      delete: 'Delete permanently',
    };
    const impacts: Record<string, string> = {
      ...statusImpacts,
      delete: 'Listings will be permanently removed. This cannot be undone.',
    };
    setBulkReason('');
    setBulkConfirm({
      action,
      label: labels[action] || action,
      impact: impacts[action] || '',
      count: selectedIds.size,
    });
  };

  const confirmBulkAction = async () => {
    if (!bulkConfirm) return;
    const reason = bulkReason.trim();
    if (reason.length < 5) return;
    setIsBulkProcessing(true);
    for (const id of selectedIds) {
      if (bulkConfirm.action === 'delete') {
        await supabase.from('properties').delete().eq('id', id);
        await logAdminAction('bulk_delete', 'property', id, { reason });
      } else {
        await supabase.from('properties').update({ status: bulkConfirm.action }).eq('id', id);
        await logAdminAction(`bulk_${bulkConfirm.action}`, 'property', id, {
          new_status: bulkConfirm.action,
          reason,
        });
      }
    }
    toast({
      title: 'Success',
      description: `${selectedIds.size} ${selectedIds.size === 1 ? 'property' : 'properties'} ${bulkConfirm.action === 'delete' ? 'deleted' : 'updated to ' + bulkConfirm.action}`,
    });
    setSelectedIds(new Set());
    setIsBulkProcessing(false);
    setBulkConfirm(null);
    setBulkReason('');
    fetchData();
  };

  if (isLoading) return <AdminLayout><div className="animate-pulse h-64 bg-muted rounded-xl" /></AdminLayout>;

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-2">
        <h1 className="font-display text-3xl font-bold">{t('admin.sidebar.properties')}</h1>
        <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5">
          <Download className="w-4 h-4" /> Export CSV
        </Button>
      </div>
      <p className="text-muted-foreground text-sm mb-6">Full property lifecycle management — approve, edit, deactivate, delete</p>

      {/* Stats Row */}
      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        {Object.entries(statusCounts).map(([key, count]) => (
          <Card key={key} className={`card-luxury cursor-pointer transition-all ${propertyFilter === key ? 'ring-2 ring-primary' : ''}`} onClick={() => setPropertyFilter(key)}>
            <CardContent className="py-3 px-4 text-center">
              <p className="text-lg font-bold">{count}</p>
              <p className="text-[11px] text-muted-foreground capitalize">{key.replace('_', ' ')}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by title, city, host name, or ID..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Property type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {propertyTypes.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Bulk Actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-4 p-3 bg-primary/5 border border-primary/20 rounded-xl">
          <CheckSquare className="w-5 h-5 text-primary" />
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Separator orientation="vertical" className="h-6" />
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => requestBulkAction('active')} disabled={isBulkProcessing}><Check className="w-3 h-3 mr-1" /> Approve</Button>
            <Button size="sm" variant="outline" onClick={() => requestBulkAction('inactive')} disabled={isBulkProcessing}><ToggleLeft className="w-3 h-3 mr-1" /> Deactivate</Button>
            <Button size="sm" variant="outline" onClick={() => requestBulkAction('draft')} disabled={isBulkProcessing}><RotateCcw className="w-3 h-3 mr-1" /> Reset Draft</Button>
            <Button size="sm" variant="destructive" onClick={() => requestBulkAction('delete')} disabled={isBulkProcessing}><Trash2 className="w-3 h-3 mr-1" /> Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      {/* Properties Grid */}
      <div className="text-xs text-muted-foreground mb-3">
        Showing {filtered.length} of {properties.length} listings
      </div>
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl">
          No properties found
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(property => {
            const host = getHost(property.host_id);
            const propBookings = bookings.filter(b => b.property_id === property.id);
            const completed = propBookings.filter(b => b.status === 'completed');
            const revenue = completed.reduce((s, b) => s + Number(b.total_price), 0);
            const isSelected = selectedIds.has(property.id);
            const shortId = shortIdFor(property);
            return (
              <Card
                key={property.id}
                className={`card-luxury overflow-hidden cursor-pointer transition-all hover:border-primary/40 hover:shadow-lg ${isSelected ? 'ring-2 ring-primary' : ''}`}
                onClick={() => setDetailProperty(property)}
              >
                {/* Image area */}
                <div className="relative aspect-[16/10] bg-muted">
                  {property.cover_image ? (
                    <img src={property.cover_image} alt={property.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Camera className="w-8 h-8 text-muted-foreground/40" />
                    </div>
                  )}
                  {/* Status pill */}
                  <div className="absolute top-3 left-3">
                    {statusBadge(property.status)}
                  </div>
                  {/* Selection checkbox */}
                  <div
                    className="absolute top-3 right-3"
                    onClick={e => { e.stopPropagation(); toggleSelect(property.id); }}
                  >
                    <div className="bg-background/80 backdrop-blur-sm rounded p-1">
                      <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(property.id)} />
                    </div>
                  </div>
                </div>

                {/* Body */}
                <CardContent className="p-4 space-y-3">
                  <div>
                    <h3 className="font-display font-bold text-base leading-tight line-clamp-1">{property.title}</h3>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <MapPin className="w-3 h-3" /> {property.city}, {property.country}
                    </p>
                  </div>

                  {/* Host chip */}
                  <div className="flex items-center justify-between bg-muted/40 rounded-lg px-2.5 py-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                        {(host?.full_name || 'U').split(' ').map(n => n[0]).slice(0, 2).join('')}
                      </div>
                      <span className="text-xs font-medium truncate">{host?.full_name || 'Unknown'}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono">{shortId}</span>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Nightly</p>
                      <p className="text-sm font-bold">${Number(property.price_per_night)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Bookings</p>
                      <p className="text-sm font-bold">{propBookings.length}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Revenue</p>
                      <p className="text-sm font-bold">{revenue > 0 ? `$${(revenue / 1000).toFixed(0)}k` : '—'}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Select all toggle for bulk */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-2 mt-4 text-xs text-muted-foreground">
          <Checkbox checked={selectedIds.size === filtered.length} onCheckedChange={toggleSelectAll} />
          <span>Select all visible ({filtered.length})</span>
        </div>
      )}

      {/* Property Detail Dialog */}
      <Dialog open={!!detailProperty && !confirmDialog && !statusConfirm} onOpenChange={() => setDetailProperty(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] p-0 overflow-hidden bg-white text-slate-900 dark:bg-white dark:text-slate-900">
          {detailProperty && (() => {
            const host = getHost(detailProperty.host_id);
            const propBookings = bookings.filter(b => b.property_id === detailProperty.id);
            const propReviews = reviews.filter(r => r.property_id === detailProperty.id);
            const revenue = propBookings.filter(b => b.status === 'completed').reduce((s, b) => s + Number(b.total_price), 0);
            const allImages = [detailProperty.cover_image, ...(detailProperty.images || [])].filter(Boolean) as string[];
            return (
              <ScrollArea className="max-h-[90vh]">
                <div className="p-6 space-y-6">
                  {/* Top bar */}
                  <button
                    type="button"
                    onClick={() => setDetailProperty(null)}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" /> Back to listings
                  </button>

                  {/*
                    1) Image first — establishes the listing visually.
                  */}
                  <div className="grid grid-cols-2 gap-2 aspect-[16/7] sm:aspect-[16/6] w-full overflow-hidden">
                    {/* Hero image — full height */}
                    <div className="relative bg-muted rounded-xl overflow-hidden h-full w-full">
                      {allImages[0] ? (
                        <img
                          src={allImages[0]}
                          alt={detailProperty.title}
                          loading="lazy"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : null}
                      {!allImages[0] && (
                        <div className="flex h-full w-full items-center justify-center">
                          <Camera className="w-10 h-10 text-muted-foreground/40" />
                        </div>
                      )}
                    </div>
                    {/* Two stacked thumbnails — together match hero height */}
                    <div className="grid grid-rows-2 gap-2 h-full">
                      {[1, 2].map(i => (
                        <div key={i} className="relative bg-muted rounded-xl overflow-hidden h-full w-full">
                          {allImages[i] ? (
                            <img
                              src={allImages[i]}
                              alt=""
                              loading="lazy"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = 'none';
                              }}
                              className="absolute inset-0 h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <Camera className="w-8 h-8 text-muted-foreground/40" />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/*
                    2) Title only — the listing name sits directly under the image,
                       flush with the gallery's bottom edge (no image overhang).
                  */}
                  <div className="pt-0">
                    <h1 className="font-display text-3xl md:text-4xl font-bold leading-tight tracking-tight text-slate-900 break-words">
                      {detailProperty.title}
                    </h1>
                  </div>

                  {/*
                    3) Pricing & status row — separate strip with location, type,
                       short ID, status pill and the nightly price.
                  */}
                  <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600 min-w-0">
                      {statusBadge(detailProperty.status)}
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="w-4 h-4 text-slate-500" />
                        {detailProperty.city}, {detailProperty.country}
                      </span>
                      <span className="inline-flex items-center gap-1.5 capitalize">
                        <Home className="w-4 h-4 text-slate-500" />
                        {detailProperty.property_type}
                      </span>
                      <span className="font-mono text-xs text-slate-500">{shortIdFor(detailProperty)}</span>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-slate-500">Nightly</p>
                      <p className="text-2xl md:text-3xl font-display font-extrabold text-primary leading-none mt-1">
                        ${Number(detailProperty.price_per_night)}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        + ${Number(detailProperty.cleaning_fee || 0)} cleaning
                        {detailProperty.service_fee_percent
                          ? ` · $${Math.round(Number(detailProperty.price_per_night) * Number(detailProperty.service_fee_percent) / 100)} service`
                          : ''}
                      </p>
                    </div>
                  </div>

                  {/* Two-column layout */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left: Details */}
                    <div className="lg:col-span-2 space-y-4">
                      <Card className="card-luxury">
                        <CardContent className="p-5">
                          <h3 className="font-display font-bold mb-4">Property details</h3>
                          <div className="grid grid-cols-4 gap-3">
                            <div className="bg-muted/40 rounded-lg p-3 text-center"><Users className="w-4 h-4 mx-auto mb-1 text-muted-foreground" /><p className="text-lg font-bold">{detailProperty.max_guests}</p><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Guests</p></div>
                            <div className="bg-muted/40 rounded-lg p-3 text-center"><Bed className="w-4 h-4 mx-auto mb-1 text-muted-foreground" /><p className="text-lg font-bold">{detailProperty.bedrooms}</p><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Bedrooms</p></div>
                            <div className="bg-muted/40 rounded-lg p-3 text-center"><Bed className="w-4 h-4 mx-auto mb-1 text-muted-foreground" /><p className="text-lg font-bold">{detailProperty.beds}</p><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Beds</p></div>
                            <div className="bg-muted/40 rounded-lg p-3 text-center"><Bath className="w-4 h-4 mx-auto mb-1 text-muted-foreground" /><p className="text-lg font-bold">{detailProperty.bathrooms}</p><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Baths</p></div>
                          </div>
                          {detailProperty.description && (
                            <div className="mt-4 p-3 bg-muted/30 rounded-lg text-sm">{detailProperty.description}</div>
                          )}
                        </CardContent>
                      </Card>

                      <Card className="card-luxury">
                        <CardContent className="p-5">
                          <h3 className="font-display font-bold mb-4">Performance</h3>
                          <div className="grid grid-cols-4 gap-3">
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Rating</p>
                              <div className="flex items-center gap-1 mt-1"><Star className="w-4 h-4 text-rating fill-rating" /><span className="text-lg font-bold">{Number(detailProperty.average_rating).toFixed(1)}</span></div>
                              <p className="text-[10px] text-muted-foreground">{propReviews.length} reviews</p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Bookings</p>
                              <p className="text-lg font-bold mt-1">{propBookings.length}</p>
                              <p className="text-[10px] text-muted-foreground">all-time</p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Revenue</p>
                              <p className="text-lg font-bold text-green-500 mt-1">${(revenue / 1000).toFixed(1)}k</p>
                              <p className="text-[10px] text-muted-foreground">lifetime</p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Listed</p>
                              <p className="text-lg font-bold mt-1">{format(new Date(detailProperty.created_at), 'MMM d')}</p>
                              <p className="text-[10px] text-muted-foreground">{format(new Date(detailProperty.created_at), 'yyyy')}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Bookings & Reviews — placed under Performance so they share its width */}
                      <Card className="card-luxury">
                        <CardContent className="p-5">
                          <Tabs defaultValue="bookings" className="w-full">
                            <TabsList className="w-full mb-4">
                              <TabsTrigger value="bookings" className="flex-1">Bookings ({propBookings.length})</TabsTrigger>
                              <TabsTrigger value="reviews" className="flex-1">Reviews ({propReviews.length})</TabsTrigger>
                            </TabsList>
                            <TabsContent value="bookings" className="space-y-2">
                              {propBookings.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No bookings for this property</p> : propBookings.slice(0, 20).map(b => (
                                <div key={b.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                                  <div>
                                    <p className="text-sm font-medium">#{b.id.slice(0, 8)}</p>
                                    <p className="text-[11px] text-muted-foreground">{format(new Date(b.check_in_date), 'MMM d')} – {format(new Date(b.check_out_date), 'MMM d, yyyy')}</p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-sm font-bold">${Number(b.total_price).toLocaleString()}</p>
                                    <Badge className={
                                      b.status === 'completed' ? 'bg-green-500/10 text-green-500 border-green-500/30' :
                                      b.status === 'confirmed' ? 'bg-blue-500/10 text-blue-500 border-blue-500/30' :
                                      b.status === 'pending' ? 'bg-amber-500/10 text-amber-500 border-amber-500/30' :
                                      b.status === 'cancelled' ? 'bg-destructive/10 text-destructive border-destructive/30' :
                                      'bg-muted text-muted-foreground border-border'
                                    }>{b.status}</Badge>
                                  </div>
                                </div>
                              ))}
                            </TabsContent>
                            <TabsContent value="reviews" className="space-y-3">
                              {propReviews.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No reviews yet</p> : propReviews.slice(0, 15).map(r => (
                                <div key={r.id} className="p-3 bg-muted/30 rounded-lg">
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-1">
                                      <Star className="w-3.5 h-3.5 text-rating fill-rating" />
                                      <span className="text-sm font-bold">{r.overall_rating}</span>
                                    </div>
                                    <span className="text-[11px] text-muted-foreground">{format(new Date(r.created_at), 'MMM d, yyyy')}</span>
                                  </div>
                                  {r.comment && <p className="text-sm">{r.comment}</p>}
                                  {r.host_response && <p className="text-sm text-muted-foreground mt-1 pl-3 border-l-2 border-primary/30">{r.host_response}</p>}
                                </div>
                              ))}
                            </TabsContent>
                          </Tabs>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Right: Admin actions */}
                    <div className="space-y-4">
                      <Card className="card-luxury">
                        <CardContent className="p-5 space-y-4">
                          <div>
                            <h3 className="font-display font-bold">Admin actions</h3>
                            <p className="text-[11px] text-muted-foreground">All actions are audited</p>
                          </div>
                          {detailProperty.status !== 'active' && (
                            <Button className="w-full gap-1.5" onClick={() => requestStatusChange(detailProperty.id, 'active')}>
                              <Check className="w-4 h-4" /> Approve & publish
                            </Button>
                          )}
                          {detailProperty.status !== 'rejected' && (
                            <Button variant="outline" className="w-full gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive" onClick={() => requestStatusChange(detailProperty.id, 'rejected')}>
                              <X className="w-4 h-4" /> Reject listing
                            </Button>
                          )}
                          {(detailProperty.status as string) !== 'suspended' && (
                            <Button variant="outline" className="w-full gap-1.5 text-orange-600 border-orange-500/30 hover:bg-orange-500/10 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-400" onClick={() => requestStatusChange(detailProperty.id, 'suspended' as StatusEnum)}>
                              <Ban className="w-4 h-4" /> Suspend listing
                            </Button>
                          )}
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Change status</p>
                            <div className="grid grid-cols-2 gap-2">
                              <Button size="sm" variant="outline" disabled={detailProperty.status === 'active'} onClick={() => requestStatusChange(detailProperty.id, 'active')}>Active</Button>
                              <Button size="sm" variant="outline" disabled={detailProperty.status === 'inactive'} onClick={() => requestStatusChange(detailProperty.id, 'inactive')}>Paused</Button>
                              <Button size="sm" variant="outline" disabled={detailProperty.status === 'pending_approval'} onClick={() => requestStatusChange(detailProperty.id, 'pending_approval')}>Pending</Button>
                              <Button size="sm" variant="outline" disabled={detailProperty.status === 'draft'} onClick={() => requestStatusChange(detailProperty.id, 'draft')}>Draft</Button>
                              <Button size="sm" variant="outline" disabled={(detailProperty.status as string) === 'suspended'} onClick={() => requestStatusChange(detailProperty.id, 'suspended' as StatusEnum)}>Suspended</Button>
                              <Button size="sm" variant="outline" disabled={detailProperty.status === 'rejected'} onClick={() => requestStatusChange(detailProperty.id, 'rejected')}>Rejected</Button>
                            </div>
                          </div>
                          <Separator />
                          <div className="grid grid-cols-2 gap-2">
                            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setEditProperty(detailProperty); setEditForm({ title: detailProperty.title, description: detailProperty.description || '', price_per_night: detailProperty.price_per_night, bedrooms: detailProperty.bedrooms, beds: detailProperty.beds, bathrooms: detailProperty.bathrooms, max_guests: detailProperty.max_guests, cleaning_fee: detailProperty.cleaning_fee, min_nights: detailProperty.min_nights, max_nights: detailProperty.max_nights, instant_booking: detailProperty.instant_booking }); setDetailProperty(null); }}>
                              <Edit className="w-3.5 h-3.5" /> Edit
                            </Button>
                            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate(`/property/${detailProperty.id}`)}>
                              <Eye className="w-3.5 h-3.5" /> View public
                            </Button>
                          </div>
                          <Button size="sm" variant="ghost" className="w-full gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirmDialog({ action: 'delete_single', count: 1 })}>
                            <Trash2 className="w-3.5 h-3.5" /> Delete permanently
                          </Button>
                        </CardContent>
                      </Card>

                      <Card className="card-luxury">
                        <CardContent className="p-5">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Host</p>
                          <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-bold flex-shrink-0">
                              {(host?.full_name || 'U').split(' ').map(n => n[0]).slice(0, 2).join('')}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-sm truncate">{host?.full_name || 'Unknown'}</p>
                              <p className="text-[11px] text-muted-foreground truncate">{host?.email}</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              onClick={() => navigate(`/user/${detailProperty.host_id}`)}
                            >
                              <UserCircle className="w-3.5 h-3.5" /> View profile
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              onClick={() => setMessageHost({ id: detailProperty.host_id, name: host?.full_name || 'Host' })}
                            >
                              <MessageSquare className="w-3.5 h-3.5" /> Message host
                            </Button>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Compliance checklist — admin review */}
                      <Card className="card-luxury">
                        <CardContent className="p-5 space-y-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className="font-display font-bold text-sm flex items-center gap-1.5">
                                <ShieldCheck className="w-4 h-4 text-primary" /> Compliance review
                              </h3>
                              <p className="text-[10px] text-muted-foreground">Verified during listing review</p>
                            </div>
                            {(() => {
                              const c = compliance[detailProperty.id] || {} as Record<ComplianceKey, boolean>;
                              const done = COMPLIANCE_KEYS.filter(k => c[k]).length;
                              return (
                                <Badge className={done === COMPLIANCE_KEYS.length ? 'bg-green-500/10 text-green-500 border-green-500/30' : 'bg-amber-500/10 text-amber-500 border-amber-500/30'}>
                                  {done}/{COMPLIANCE_KEYS.length}
                                </Badge>
                              );
                            })()}
                          </div>
                          {([
                            { key: 'host_id_verified' as ComplianceKey, label: 'Host ID verified', icon: Shield, required: false },
                            { key: 'tax_form' as ComplianceKey, label: 'Tax form on file', icon: FileText, required: false },
                            { key: 'insurance' as ComplianceKey, label: 'Insurance valid', icon: ShieldCheck, required: false },
                            { key: 'str_license' as ComplianceKey, label: 'STR license', icon: FileCheck, required: true },
                          ]).map(item => {
                            const checked = !!compliance[detailProperty.id]?.[item.key];
                            const Icon = item.icon;
                            return (
                              <button
                                key={item.key}
                                type="button"
                                onClick={() => setComplianceFlag(detailProperty.id, item.key, !checked)}
                                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
                                  checked
                                    ? 'bg-green-500/10 border-green-500/30 hover:bg-green-500/15'
                                    : 'bg-muted/30 border-border hover:bg-muted/50'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <Icon className={`w-4 h-4 flex-shrink-0 ${checked ? 'text-green-500' : 'text-muted-foreground'}`} />
                                  <span className="text-xs font-medium truncate">
                                    {item.label}
                                    {item.required && <span className="text-destructive ml-1">*</span>}
                                  </span>
                                </div>
                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                                  checked ? 'bg-green-500 border-green-500' : 'border-muted-foreground/40'
                                }`}>
                                  {checked && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                                </div>
                              </button>
                            );
                          })}
                          {!compliance[detailProperty.id]?.str_license && (
                            <p className="text-[10px] text-destructive flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> STR license is required before approval
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </div>
              </ScrollArea>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Edit Property Dialog */}
      <Dialog open={!!editProperty} onOpenChange={() => { setEditProperty(null); setEditForm({}); }}>
        <DialogContent className="max-w-lg max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="font-display">Edit Property</DialogTitle>
            <DialogDescription>Admin override — changes are audited</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[55vh] pr-4">
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Title</label>
                <Input value={editForm.title || ''} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Description</label>
                <Textarea value={editForm.description || ''} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} rows={3} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Price per Night ($)</label>
                  <Input type="number" value={editForm.price_per_night ?? ''} onChange={e => setEditForm(p => ({ ...p, price_per_night: Number(e.target.value) }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Cleaning Fee ($)</label>
                  <Input type="number" value={editForm.cleaning_fee ?? ''} onChange={e => setEditForm(p => ({ ...p, cleaning_fee: Number(e.target.value) }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Bedrooms</label>
                  <Input type="number" value={editForm.bedrooms ?? ''} onChange={e => setEditForm(p => ({ ...p, bedrooms: Number(e.target.value) }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Beds</label>
                  <Input type="number" value={editForm.beds ?? ''} onChange={e => setEditForm(p => ({ ...p, beds: Number(e.target.value) }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Bathrooms</label>
                  <Input type="number" value={editForm.bathrooms ?? ''} onChange={e => setEditForm(p => ({ ...p, bathrooms: Number(e.target.value) }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Max Guests</label>
                  <Input type="number" value={editForm.max_guests ?? ''} onChange={e => setEditForm(p => ({ ...p, max_guests: Number(e.target.value) }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Min Nights</label>
                  <Input type="number" value={editForm.min_nights ?? ''} onChange={e => setEditForm(p => ({ ...p, min_nights: Number(e.target.value) }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Max Nights</label>
                  <Input type="number" value={editForm.max_nights ?? ''} onChange={e => setEditForm(p => ({ ...p, max_nights: Number(e.target.value) }))} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox checked={editForm.instant_booking ?? false} onCheckedChange={c => setEditForm(p => ({ ...p, instant_booking: !!c }))} />
                <label className="text-sm">Instant Booking</label>
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditProperty(null); setEditForm({}); }}>Cancel</Button>
            <Button onClick={savePropertyEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single-property delete (from detail dialog) */}
      <Dialog open={confirmDialog?.action === 'delete_single'} onOpenChange={() => setConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" /> Permanently delete property?
            </DialogTitle>
            <DialogDescription>
              This will permanently delete the property and all associated data. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>Cancel</Button>
            <Button variant="destructive" disabled={isBulkProcessing} onClick={() => {
              if (detailProperty) {
                deleteProperty(detailProperty.id);
                setDetailProperty(null);
                setConfirmDialog(null);
              }
            }}>{isBulkProcessing ? 'Processing...' : 'Delete'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status Change Confirmation — requires reason */}
      <Dialog
        open={!!statusConfirm}
        onOpenChange={(open) => { if (!open) { setStatusConfirm(null); setStatusReason(''); } }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Change status to "{statusConfirm?.label}"?
            </DialogTitle>
            <DialogDescription>{statusConfirm?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-foreground">
              <p className="font-semibold mb-1 text-amber-600 dark:text-amber-400">Impact</p>
              <p className="text-muted-foreground text-xs leading-relaxed">{statusConfirm?.impact}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Reason <span className="text-destructive">*</span>
              </label>
              <Textarea
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
                placeholder="Briefly explain why this change is being made (recorded in audit log)…"
                rows={3}
                className="mt-1"
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                {statusReason.trim().length < 5
                  ? `Minimum 5 characters (${statusReason.trim().length}/5)`
                  : `${statusReason.trim().length} characters`}
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setStatusConfirm(null); setStatusReason(''); }}>
              Cancel
            </Button>
            <Button onClick={confirmStatusChange} disabled={statusReason.trim().length < 5}>
              Confirm change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Action Confirmation — requires reason */}
      <Dialog
        open={!!bulkConfirm}
        onOpenChange={(open) => { if (!open) { setBulkConfirm(null); setBulkReason(''); } }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className={`w-5 h-5 ${bulkConfirm?.action === 'delete' ? 'text-destructive' : 'text-amber-500'}`} />
              {bulkConfirm?.label} {bulkConfirm?.count} {bulkConfirm?.count === 1 ? 'property' : 'properties'}?
            </DialogTitle>
            <DialogDescription>
              This action will be applied to all selected listings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className={`rounded-lg border p-3 text-sm ${bulkConfirm?.action === 'delete' ? 'border-destructive/30 bg-destructive/10' : 'border-amber-500/30 bg-amber-500/10'}`}>
              <p className={`font-semibold mb-1 ${bulkConfirm?.action === 'delete' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'}`}>Impact</p>
              <p className="text-muted-foreground text-xs leading-relaxed">{bulkConfirm?.impact}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Reason <span className="text-destructive">*</span>
              </label>
              <Textarea
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
                placeholder="Briefly explain why (recorded in audit log)…"
                rows={3}
                className="mt-1"
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                {bulkReason.trim().length < 5
                  ? `Minimum 5 characters (${bulkReason.trim().length}/5)`
                  : `${bulkReason.trim().length} characters`}
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setBulkConfirm(null); setBulkReason(''); }}>
              Cancel
            </Button>
            <Button
              variant={bulkConfirm?.action === 'delete' ? 'destructive' : 'default'}
              disabled={bulkReason.trim().length < 5 || isBulkProcessing}
              onClick={confirmBulkAction}
            >
              {isBulkProcessing ? 'Processing…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Direct admin → host messaging */}
      <AdminMessageDialog
        open={!!messageHost}
        onClose={() => setMessageHost(null)}
        recipientId={messageHost?.id ?? null}
        recipientName={messageHost?.name ?? 'Host'}
      />
    </AdminLayout>
  );
}
