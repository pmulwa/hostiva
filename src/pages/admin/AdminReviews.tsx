import { useState, useEffect } from 'react';
import { logAdminAction } from '@/lib/audit';
import { useTranslation } from 'react-i18next';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Star, Eye, MoreHorizontal, CheckSquare, RotateCcw, Trash2, AlertTriangle, EyeOff, MapPin, Shield, Sparkles, Bed, MessageSquare } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import type { Database } from '@/integrations/supabase/types';

type Review = Database['public']['Tables']['reviews']['Row'];

interface MutualReview {
  id: string;
  booking_id: string;
  property_id: string;
  guest_id: string;
  host_id: string;
  reviewer_type: string;
  location_rating: number | null;
  security_rating: number | null;
  cleanliness_rating: number | null;
  beddings_rating: number | null;
  communication_rating: number | null;
  overall_rating: number | null;
  comment: string | null;
  review_window_closes_at: string;
  is_published: boolean;
  created_at: string;
  guest_profile?: { full_name: string | null; email: string } | null;
  host_profile?: { full_name: string | null; email: string } | null;
  property_title?: string;
}

const ratingIcon = (key: string) => {
  const icons: Record<string, any> = { location: MapPin, security: Shield, cleanliness: Sparkles, beddings: Bed, communication: MessageSquare };
  return icons[key] || Star;
};

export default function AdminReviews() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [reviews, setReviews] = useState<(Review & { properties?: { title: string } })[]>([]);
  const [mutualReviews, setMutualReviews] = useState<MutualReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedMutualIds, setSelectedMutualIds] = useState<Set<string>>(new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ action: string; count: number; type: 'legacy' | 'mutual' } | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    const [revRes, mutualRes] = await Promise.all([
      supabase.from('reviews').select('*, properties(title)').order('created_at', { ascending: false }),
      supabase.from('mutual_reviews' as any).select('*').order('created_at', { ascending: false }),
    ]);
    if (revRes.data) setReviews(revRes.data as any);
    
    if (mutualRes.data) {
      // Enrich with profiles and property titles
      const mr = mutualRes.data as any[];
      const userIds = [...new Set(mr.flatMap(r => [r.guest_id, r.host_id]))];
      const propIds = [...new Set(mr.map(r => r.property_id))];
      
      const [profilesRes, propsRes] = await Promise.all([
        supabase.from('profiles').select('user_id, full_name, email').in('user_id', userIds),
        supabase.from('properties').select('id, title').in('id', propIds),
      ]);
      
      const profileMap = new Map(profilesRes.data?.map(p => [p.user_id, p]) || []);
      const propMap = new Map(propsRes.data?.map(p => [p.id, p.title]) || []);
      
      setMutualReviews(mr.map(r => ({
        ...r,
        guest_profile: profileMap.get(r.guest_id) || null,
        host_profile: profileMap.get(r.host_id) || null,
        property_title: propMap.get(r.property_id) || 'Unknown',
      })));
    }
    setIsLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const toggleVisibility = async (id: string, isPublic: boolean) => {
    const { error } = await supabase.from('reviews').update({ is_public: !isPublic }).eq('id', id);
    if (!error) {
      await logAdminAction('toggle_visibility', 'review', id, { new_visibility: !isPublic ? 'public' : 'hidden' });
      toast({ title: t('common.success'), description: t('admin.reviewUpdated') }); fetchData();
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleSelectAll = () => {
    setSelectedIds(prev => prev.size === reviews.length ? new Set() : new Set(reviews.map(r => r.id)));
  };
  const toggleMutualSelect = (id: string) => {
    setSelectedMutualIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleMutualSelectAll = () => {
    setSelectedMutualIds(prev => prev.size === mutualReviews.length ? new Set() : new Set(mutualReviews.map(r => r.id)));
  };

  const bulkAction = async (action: string, type: 'legacy' | 'mutual') => {
    setIsBulkProcessing(true);
    const ids = type === 'legacy' ? selectedIds : selectedMutualIds;
    const table = type === 'legacy' ? 'reviews' : 'mutual_reviews';
    
    for (const id of ids) {
      if (action === 'delete') {
        await supabase.from(table as any).delete().eq('id', id);
        await logAdminAction('bulk_delete', type === 'legacy' ? 'review' : 'mutual_review', id);
      } else if (action === 'reset' && type === 'legacy') {
        await supabase.from('reviews').update({ host_response: null, is_public: true }).eq('id', id);
        await logAdminAction('bulk_reset', 'review', id);
      } else if (action === 'publish' && type === 'mutual') {
        await supabase.from('mutual_reviews' as any).update({ is_published: true } as any).eq('id', id);
        await logAdminAction('publish', 'mutual_review', id);
      } else if (action === 'unpublish' && type === 'mutual') {
        await supabase.from('mutual_reviews' as any).update({ is_published: false } as any).eq('id', id);
        await logAdminAction('unpublish', 'mutual_review', id);
      } else if (action === 'show') {
        await supabase.from('reviews').update({ is_public: true }).eq('id', id);
        await logAdminAction('bulk_show', 'review', id);
      } else if (action === 'hide') {
        await supabase.from('reviews').update({ is_public: false }).eq('id', id);
        await logAdminAction('bulk_hide', 'review', id);
      }
    }
    toast({ title: 'Success', description: `${ids.size} reviews updated` });
    if (type === 'legacy') setSelectedIds(new Set());
    else setSelectedMutualIds(new Set());
    setIsBulkProcessing(false);
    setConfirmDialog(null);
    fetchData();
  };

  if (isLoading) return <AdminLayout><div className="animate-pulse h-64 bg-muted rounded-xl" /></AdminLayout>;

  return (
    <AdminLayout>
      <h1 className="font-display text-3xl font-bold mb-2">Reviews</h1>
      <p className="text-muted-foreground text-sm mb-6">Moderate property reviews and mutual ratings</p>

      <Tabs defaultValue="property">
        <TabsList className="mb-6">
          <TabsTrigger value="property">Property Reviews ({reviews.length})</TabsTrigger>
          <TabsTrigger value="mutual">Mutual Ratings ({mutualReviews.length})</TabsTrigger>
        </TabsList>

        {/* ═══ Property Reviews Tab ═══ */}
        <TabsContent value="property">
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 mb-4 p-3 bg-primary/5 border border-primary/20 rounded-xl">
              <CheckSquare className="w-5 h-5 text-primary" />
              <span className="text-sm font-medium">{selectedIds.size} selected</span>
              <Separator orientation="vertical" className="h-6" />
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => bulkAction('show', 'legacy')} disabled={isBulkProcessing}><Eye className="w-3 h-3 mr-1" /> Public</Button>
                <Button size="sm" variant="outline" onClick={() => bulkAction('hide', 'legacy')} disabled={isBulkProcessing}><EyeOff className="w-3 h-3 mr-1" /> Hide</Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmDialog({ action: 'reset', count: selectedIds.size, type: 'legacy' })} disabled={isBulkProcessing}><RotateCcw className="w-3 h-3 mr-1" /> Reset</Button>
                <Button size="sm" variant="destructive" onClick={() => setConfirmDialog({ action: 'delete', count: selectedIds.size, type: 'legacy' })} disabled={isBulkProcessing}><Trash2 className="w-3 h-3 mr-1" /> Delete</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear</Button>
              </div>
            </div>
          )}

          <Card className="card-luxury">
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"><Checkbox checked={reviews.length > 0 && selectedIds.size === reviews.length} onCheckedChange={toggleSelectAll} /></TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Comment</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Visibility</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviews.map(review => (
                    <TableRow key={review.id} className={selectedIds.has(review.id) ? 'bg-primary/5' : ''}>
                      <TableCell><Checkbox checked={selectedIds.has(review.id)} onCheckedChange={() => toggleSelect(review.id)} /></TableCell>
                      <TableCell className="text-sm">{(review as any).properties?.title || 'N/A'}</TableCell>
                      <TableCell><div className="flex items-center gap-1"><Star className="w-3.5 h-3.5 text-rating fill-rating" /><span className="text-sm font-semibold">{review.overall_rating}</span></div></TableCell>
                      <TableCell className="max-w-xs"><p className="text-sm text-muted-foreground truncate">{review.comment || 'No comment'}</p></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{format(new Date(review.created_at), 'MMM d, yyyy')}</TableCell>
                      <TableCell>
                        {review.is_public ? <Badge className="bg-green-500/10 text-green-500 border-green-500/30">Public</Badge> : <Badge className="bg-muted text-muted-foreground border-border">Hidden</Badge>}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="sm"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => toggleVisibility(review.id, !!review.is_public)}>
                              {review.is_public ? <><EyeOff className="w-4 h-4 mr-2" /> Hide</> : <><Eye className="w-4 h-4 mr-2" /> Show</>}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {reviews.length === 0 && <div className="text-center py-12 text-muted-foreground">No reviews found</div>}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ Mutual Ratings Tab ═══ */}
        <TabsContent value="mutual">
          {selectedMutualIds.size > 0 && (
            <div className="flex items-center gap-3 mb-4 p-3 bg-primary/5 border border-primary/20 rounded-xl">
              <CheckSquare className="w-5 h-5 text-primary" />
              <span className="text-sm font-medium">{selectedMutualIds.size} selected</span>
              <Separator orientation="vertical" className="h-6" />
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => bulkAction('publish', 'mutual')} disabled={isBulkProcessing}><Eye className="w-3 h-3 mr-1" /> Publish</Button>
                <Button size="sm" variant="outline" onClick={() => bulkAction('unpublish', 'mutual')} disabled={isBulkProcessing}><EyeOff className="w-3 h-3 mr-1" /> Unpublish</Button>
                <Button size="sm" variant="destructive" onClick={() => setConfirmDialog({ action: 'delete', count: selectedMutualIds.size, type: 'mutual' })} disabled={isBulkProcessing}><Trash2 className="w-3 h-3 mr-1" /> Delete</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedMutualIds(new Set())}>Clear</Button>
              </div>
            </div>
          )}

          <Card className="card-luxury">
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"><Checkbox checked={mutualReviews.length > 0 && selectedMutualIds.size === mutualReviews.length} onCheckedChange={toggleMutualSelectAll} /></TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Reviewer</TableHead>
                    <TableHead>About</TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead>Ratings</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mutualReviews.map(mr => {
                    const isGuest = mr.reviewer_type === 'guest';
                    const reviewer = isGuest ? mr.guest_profile : mr.host_profile;
                    const about = isGuest ? mr.host_profile : mr.guest_profile;
                    const ratings = [
                      { key: 'location', val: mr.location_rating },
                      { key: 'security', val: mr.security_rating },
                      { key: 'cleanliness', val: mr.cleanliness_rating },
                      { key: 'beddings', val: mr.beddings_rating },
                      { key: 'communication', val: mr.communication_rating },
                    ];
                    return (
                      <TableRow key={mr.id} className={selectedMutualIds.has(mr.id) ? 'bg-primary/5' : ''}>
                        <TableCell><Checkbox checked={selectedMutualIds.has(mr.id)} onCheckedChange={() => toggleMutualSelect(mr.id)} /></TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {isGuest ? 'Guest → Host' : 'Host → Guest'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm font-medium">{reviewer?.full_name || reviewer?.email || 'Unknown'}</TableCell>
                        <TableCell className="text-sm">{about?.full_name || about?.email || 'Unknown'}</TableCell>
                        <TableCell className="text-sm max-w-[120px] truncate">{mr.property_title}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {ratings.map(r => {
                              const Icon = ratingIcon(r.key);
                              return (
                                <div key={r.key} className="flex items-center gap-0.5" title={r.key}>
                                  <Icon className="w-3 h-3 text-muted-foreground" />
                                  <span className="text-xs font-bold">{r.val || '-'}</span>
                                </div>
                              );
                            })}
                          </div>
                        </TableCell>
                        <TableCell>
                          {mr.is_published 
                            ? <Badge className="bg-green-500/10 text-green-500 border-green-500/30">Published</Badge> 
                            : <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30">Pending</Badge>
                          }
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{format(new Date(mr.created_at), 'MMM d, yyyy')}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={async () => {
                                await supabase.from('mutual_reviews' as any).update({ is_published: !mr.is_published } as any).eq('id', mr.id);
                                await logAdminAction(mr.is_published ? 'unpublish' : 'publish', 'mutual_review', mr.id);
                                fetchData();
                              }}>
                                {mr.is_published ? <><EyeOff className="w-4 h-4 mr-2" /> Unpublish</> : <><Eye className="w-4 h-4 mr-2" /> Publish</>}
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onClick={async () => {
                                await supabase.from('mutual_reviews' as any).delete().eq('id', mr.id);
                                await logAdminAction('delete', 'mutual_review', mr.id);
                                toast({ title: 'Deleted' }); fetchData();
                              }}>
                                <Trash2 className="w-4 h-4 mr-2" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {mutualReviews.length === 0 && <div className="text-center py-12 text-muted-foreground">No mutual ratings found</div>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Confirmation Dialog */}
      <Dialog open={!!confirmDialog} onOpenChange={() => setConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Confirm {confirmDialog?.action === 'delete' ? 'Deletion' : 'Reset'}
            </DialogTitle>
            <DialogDescription>
              {confirmDialog?.action === 'delete'
                ? `This will permanently delete ${confirmDialog.count} review${confirmDialog.count > 1 ? 's' : ''}. This cannot be undone.`
                : `This will reset ${confirmDialog?.count} review${(confirmDialog?.count || 0) > 1 ? 's' : ''}.`
              }
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmDialog && bulkAction(confirmDialog.action, confirmDialog.type)} disabled={isBulkProcessing}>
              {isBulkProcessing ? 'Processing...' : confirmDialog?.action === 'delete' ? 'Delete All' : 'Reset All'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
