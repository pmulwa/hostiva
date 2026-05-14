import { useEffect, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { logAdminAction } from '@/lib/audit';
import { Shield, FileText, Check, X, Eye, Clock, CheckCircle2, XCircle, User } from 'lucide-react';
import { format } from 'date-fns';

type VerificationRow = {
  id: string;
  user_id: string;
  verification_type: string;
  status: string;
  data: Record<string, unknown> | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

type Profile = {
  user_id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  phone: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  government_id: 'Government ID',
  phone: 'Phone',
  work_email: 'Work Email',
  email: 'Email',
};

const HOST_TYPES = ['government_id'];

export default function AdminVerifications() {
  const { toast } = useToast();
  const [rows, setRows] = useState<VerificationRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');
  const [viewing, setViewing] = useState<VerificationRow | null>(null);
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [docUrlBack, setDocUrlBack] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<VerificationRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [processing, setProcessing] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const { data: vData } = await supabase
      .from('user_verifications')
      .select('*')
      .in('verification_type', HOST_TYPES)
      .order('updated_at', { ascending: false });

    const list = (vData || []) as VerificationRow[];
    setRows(list);

    const userIds = Array.from(new Set(list.map(v => v.user_id)));
    if (userIds.length) {
      const { data: pData } = await supabase
        .from('profiles')
        .select('user_id, full_name, email, avatar_url, phone')
        .in('user_id', userIds);
      const map: Record<string, Profile> = {};
      (pData || []).forEach((p: Profile) => { map[p.user_id] = p; });
      setProfiles(map);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const openDocument = async (row: VerificationRow) => {
    setViewing(row);
    setDocUrl(null);
    setDocUrlBack(null);
    const data = (row.data as { file_path?: string; file_path_back?: string } | null);
    const filePath = data?.file_path;
    const filePathBack = data?.file_path_back;
    if (filePath) {
      const { data: signed } = await supabase.storage
        .from('verification-documents')
        .createSignedUrl(filePath, 60 * 10);
      setDocUrl(signed?.signedUrl || null);
    }
    if (filePathBack) {
      const { data: signedBack } = await supabase.storage
        .from('verification-documents')
        .createSignedUrl(filePathBack, 60 * 10);
      setDocUrlBack(signedBack?.signedUrl || null);
    }
  };

  const approve = async (row: VerificationRow) => {
    setProcessing(true);
    const { error } = await supabase
      .from('user_verifications')
      .update({ status: 'verified', verified_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setProcessing(false);
      return;
    }

    // If this was the 3rd host verification, also flip is_verified on profile
    const { data: allHostVerif } = await supabase
      .from('user_verifications')
      .select('verification_type, status')
      .eq('user_id', row.user_id)
      .in('verification_type', HOST_TYPES);
    const allApproved = HOST_TYPES.every(t =>
      (allHostVerif || []).some(v => v.verification_type === t && v.status === 'verified')
    );
    if (allApproved) {
      await supabase.from('profiles').update({ is_verified: true }).eq('user_id', row.user_id);
    }

    await logAdminAction('approve', 'user_verification', row.id, {
      user_id: row.user_id,
      verification_type: row.verification_type,
    });

    toast({ title: 'Approved', description: `${TYPE_LABELS[row.verification_type]} verified.` });
    setViewing(null);
    setProcessing(false);
    fetchData();
  };

  const reject = async () => {
    if (!rejecting) return;
    setProcessing(true);
    const newData = {
      ...(rejecting.data || {}),
      reject_reason: rejectReason || 'No reason provided',
    } as unknown as Record<string, never>;
    const { error } = await supabase
      .from('user_verifications')
      .update({ status: 'rejected', data: newData })
      .eq('id', rejecting.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setProcessing(false);
      return;
    }
    await logAdminAction('reject', 'user_verification', rejecting.id, {
      user_id: rejecting.user_id,
      verification_type: rejecting.verification_type,
      reason: rejectReason,
    });
    toast({ title: 'Rejected', description: 'Host has been notified.' });
    setRejecting(null);
    setRejectReason('');
    setViewing(null);
    setProcessing(false);
    fetchData();
  };

  const filtered = rows.filter(r => r.status === tab);

  const counts = {
    pending: rows.filter(r => r.status === 'pending').length,
    verified: rows.filter(r => r.status === 'verified').length,
    rejected: rows.filter(r => r.status === 'rejected').length,
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            Host Verifications
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Review and approve host verification documents. Hosts cannot list properties until all 3 are approved.
          </p>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="pending" className="gap-1.5">
              <Clock className="w-4 h-4" /> Pending
              <Badge variant="outline" className="ml-1 bg-amber-500/10 text-amber-600 border-amber-500/30 text-[10px] px-1.5 py-0">
                {counts.pending}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="verified" className="gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> Approved
              <Badge variant="outline" className="ml-1 bg-green-500/10 text-green-600 border-green-500/30 text-[10px] px-1.5 py-0">
                {counts.verified}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="rejected" className="gap-1.5">
              <XCircle className="w-4 h-4" /> Rejected
              <Badge variant="outline" className="ml-1 bg-destructive/10 text-destructive border-destructive/30 text-[10px] px-1.5 py-0">
                {counts.rejected}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="mt-4">
            {loading ? (
              <p className="text-sm text-muted-foreground py-12 text-center">Loading verifications…</p>
            ) : filtered.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <Shield className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground">No {tab} verifications.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filtered.map(row => {
                  const profile = profiles[row.user_id];
                  const filePath = (row.data as { file_path?: string; file_name?: string; document_type?: string } | null);
                  const docTypeLabels: Record<string, string> = {
                    national_id: 'National ID',
                    drivers_license: "Driver's License",
                    passport: 'Passport',
                  };
                  const docTypeLabel = filePath?.document_type ? docTypeLabels[filePath.document_type] : null;
                  return (
                    <Card key={row.id} className="hover:shadow-md transition-shadow">
                      <CardContent className="py-4 flex items-center gap-4">
                        <Avatar className="w-12 h-12 shrink-0">
                          <AvatarImage src={profile?.avatar_url || ''} />
                          <AvatarFallback>
                            {(profile?.full_name?.[0] || profile?.email?.[0] || 'U').toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold truncate">{profile?.full_name || 'Unknown user'}</p>
                            <Badge variant="outline" className="text-xs">
                              {TYPE_LABELS[row.verification_type] || row.verification_type}
                            </Badge>
                            {docTypeLabel && (
                              <Badge className="bg-primary/10 text-primary border-primary/30 text-xs">
                                {docTypeLabel}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{profile?.email}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Submitted {format(new Date(row.updated_at), 'MMM d, yyyy · h:mm a')}
                            {filePath?.file_name && ` · ${filePath.file_name}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {filePath?.file_path && (
                            <Button size="sm" variant="outline" onClick={() => openDocument(row)}>
                              <Eye className="w-4 h-4 mr-1.5" /> View
                            </Button>
                          )}
                          {row.status === 'pending' && (
                            <>
                              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => approve(row)} disabled={processing}>
                                <Check className="w-4 h-4 mr-1.5" /> Approve
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => setRejecting(row)} disabled={processing}>
                                <X className="w-4 h-4 mr-1.5" /> Reject
                              </Button>
                            </>
                          )}
                          {row.status === 'verified' && (
                            <Badge className="bg-green-100 text-green-700 border-green-200">Approved</Badge>
                          )}
                          {row.status === 'rejected' && (
                            <Badge variant="destructive">Rejected</Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Document viewer dialog */}
        <Dialog open={!!viewing} onOpenChange={open => { if (!open) { setViewing(null); setDocUrl(null); setDocUrlBack(null); } }}>
          <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                {viewing && (TYPE_LABELS[viewing.verification_type] || viewing.verification_type)}
              </DialogTitle>
            </DialogHeader>
            {viewing && (
              <div className="space-y-4">
                <div className="bg-muted/30 rounded-xl p-4 flex items-center gap-3">
                  <User className="w-5 h-5 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{profiles[viewing.user_id]?.full_name || 'Unknown'}</p>
                    <p className="text-xs text-muted-foreground truncate">{profiles[viewing.user_id]?.email}</p>
                  </div>
                </div>
                {docUrl ? (
                  <div className="space-y-3">
                    <div>
                      {docUrlBack && <p className="text-xs font-medium text-muted-foreground mb-1.5">Front</p>}
                      {/\.(jpg|jpeg|png|webp|gif)$/i.test(docUrl.split('?')[0]) ? (
                        <img src={docUrl} alt="Verification document — front" className="w-full rounded-xl border" />
                      ) : (
                        <iframe src={docUrl} className="w-full h-[60vh] rounded-xl border" title="Verification document — front" />
                      )}
                    </div>
                    {docUrlBack && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1.5">Back</p>
                        {/\.(jpg|jpeg|png|webp|gif)$/i.test(docUrlBack.split('?')[0]) ? (
                          <img src={docUrlBack} alt="Verification document — back" className="w-full rounded-xl border" />
                        ) : (
                          <iframe src={docUrlBack} className="w-full h-[60vh] rounded-xl border" title="Verification document — back" />
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-12 text-center">Loading document…</p>
                )}
              </div>
            )}
            {viewing?.status === 'pending' && (
              <DialogFooter>
                <Button variant="destructive" onClick={() => setRejecting(viewing)} disabled={processing}>
                  <X className="w-4 h-4 mr-1.5" /> Reject
                </Button>
                <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => approve(viewing)} disabled={processing}>
                  <Check className="w-4 h-4 mr-1.5" /> Approve
                </Button>
              </DialogFooter>
            )}
          </DialogContent>
        </Dialog>

        {/* Reject reason dialog */}
        <Dialog open={!!rejecting} onOpenChange={open => { if (!open) { setRejecting(null); setRejectReason(''); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject verification</DialogTitle>
            </DialogHeader>
            <div className="py-2">
              <Textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Explain why this verification is being rejected (sent to the host)..."
                rows={4}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setRejecting(null); setRejectReason(''); }}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={reject} disabled={processing || !rejectReason.trim()}>
                Confirm Reject
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
