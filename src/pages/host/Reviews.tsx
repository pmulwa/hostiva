import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { usePlatformControls } from '@/hooks/usePlatformControls';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Star, MessageSquare, ThumbsUp, TrendingUp, Reply, Send, Pencil } from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';

type Review = Database['public']['Tables']['reviews']['Row'];
type Profile = Database['public']['Tables']['profiles']['Row'];

type ReviewWithGuest = Review & {
  guest_profile?: Profile | null;
  property_title?: string;
};

export default function HostReviews() {
  const { user, isHost } = useAuth();
  const navigate = useNavigate();
  const { controls: platformControls } = usePlatformControls();
  const responsesAllowed = platformControls.host_rights.respond_to_reviews !== false;
  const { t } = useTranslation();
  const { toast } = useToast();
  const [reviews, setReviews] = useState<ReviewWithGuest[]>([]);
  const [stats, setStats] = useState({
    averageRating: 0,
    totalReviews: 0,
    fiveStarCount: 0,
    responseRate: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  // Response dialog state
  const [respondingReview, setRespondingReview] = useState<ReviewWithGuest | null>(null);
  const [responseText, setResponseText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    if (!isHost) { navigate('/become-host'); return; }
    import('@/hooks/useHostModeGuard').then(m => m.setHostMode('host'));
    fetchReviews();
  }, [user, isHost, navigate]);

  const fetchReviews = async () => {
    if (!user) return;
    setIsLoading(true);

    const { data } = await supabase
      .from('reviews')
      .select('*')
      .eq('host_id', user.id)
      .order('created_at', { ascending: false });

    if (data) {
      // Fetch guest profiles and property titles
      const guestIds = [...new Set(data.map(r => r.guest_id))];
      const propertyIds = [...new Set(data.map(r => r.property_id))];

      const [guestRes, propRes] = await Promise.all([
        supabase.from('profiles').select('*').in('user_id', guestIds),
        supabase.from('properties').select('id, title').in('id', propertyIds),
      ]);

      const guestMap = new Map(guestRes.data?.map(p => [p.user_id, p]) || []);
      const propMap = new Map(propRes.data?.map(p => [p.id, p.title]) || []);

      const enriched: ReviewWithGuest[] = data.map(r => ({
        ...r,
        guest_profile: guestMap.get(r.guest_id) || null,
        property_title: propMap.get(r.property_id) || undefined,
      }));

      setReviews(enriched);

      const total = data.length;
      const avg = total > 0 ? data.reduce((s, r) => s + r.overall_rating, 0) / total : 0;
      const fiveStar = data.filter(r => r.overall_rating === 5).length;
      const responded = data.filter(r => r.host_response).length;

      setStats({
        averageRating: Math.round(avg * 10) / 10,
        totalReviews: total,
        fiveStarCount: fiveStar,
        responseRate: total > 0 ? Math.round((responded / total) * 100) : 0,
      });
    }
    setIsLoading(false);
  };

  const openResponseDialog = (review: ReviewWithGuest) => {
    setRespondingReview(review);
    setResponseText(review.host_response || '');
  };

  const submitResponse = async () => {
    if (!respondingReview || !responseText.trim()) return;
    setIsSubmitting(true);

    const { error } = await supabase
      .from('reviews')
      .update({ host_response: responseText.trim() })
      .eq('id', respondingReview.id);

    setIsSubmitting(false);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Response saved', description: 'Your reply has been published.' });
      setRespondingReview(null);
      setResponseText('');
      fetchReviews();
    }
  };

  const renderStars = (rating: number) => (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <Star key={s} className={`w-4 h-4 ${s <= rating ? 'fill-rating text-rating' : 'text-muted-foreground/30'}`} />
      ))}
    </div>
  );

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="animate-pulse space-y-8">
            <div className="h-8 bg-muted rounded w-1/3" />
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {[...Array(4)].map((_, i) => <div key={i} className="h-32 bg-muted rounded-xl" />)}
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold mb-2">{t('hostReviews.title')}</h1>
          <p className="text-muted-foreground">{t('hostReviews.subtitle')}</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="card-luxury">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t('hostReviews.averageRating')}</p>
                  <p className="font-display text-3xl font-extrabold text-rating">{stats.averageRating}</p>
                  {renderStars(Math.round(stats.averageRating))}
                </div>
                <div className="w-12 h-12 rounded-xl bg-rating/10 flex items-center justify-center">
                  <Star className="w-6 h-6 fill-rating text-rating" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="card-luxury">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t('hostReviews.totalReviews')}</p>
                  <p className="font-display text-3xl font-extrabold text-rating">{stats.totalReviews}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <MessageSquare className="w-6 h-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="card-luxury">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t('hostReviews.fiveStarReviews')}</p>
                  <p className="font-display text-3xl font-bold">{stats.fiveStarCount}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                  <ThumbsUp className="w-6 h-6 text-green-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="card-luxury">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t('hostReviews.responseRate')}</p>
                  <p className="font-display text-3xl font-bold">{stats.responseRate}%</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Reviews List */}
        <div className="space-y-4">
          {reviews.length > 0 ? reviews.map(review => {
            const guest = review.guest_profile;
            const guestName = guest?.full_name || 'Guest';
            const guestInitial = guestName[0]?.toUpperCase() || 'G';

            return (
              <Card key={review.id} className="card-luxury">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <Avatar className="w-10 h-10">
                        <AvatarImage src={guest?.avatar_url || ''} />
                        <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
                          {guestInitial}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-sm text-foreground">{guestName}</p>
                        <p className="text-xs text-muted-foreground">
                          {review.property_title && (
                            <span className="text-primary">{review.property_title} · </span>
                          )}
                          {format(new Date(review.created_at), 'MMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                    {renderStars(review.overall_rating)}
                  </div>

                  {review.comment && (
                    <p className="text-sm text-foreground mb-4 leading-relaxed">{review.comment}</p>
                  )}

                  {/* Existing host response */}
                  {review.host_response ? (
                    <div className="bg-muted/50 rounded-lg p-4 mt-2">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Reply className="w-3.5 h-3.5 text-primary" />
                          <span className="text-xs font-semibold text-muted-foreground">{t('hostReviews.yourResponse')}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => openResponseDialog(review)}
                          disabled={!responsesAllowed}
                        >
                          <Pencil className="w-3 h-3" /> {t('hostReviews.edit')}
                        </Button>
                      </div>
                      <p className="text-sm text-foreground">{review.host_response}</p>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 gap-1.5"
                      onClick={() => openResponseDialog(review)}
                      disabled={!responsesAllowed}
                      title={!responsesAllowed ? t('hostReviews.responsesDisabled') : undefined}
                    >
                      <Reply className="w-4 h-4" /> {t('hostReviews.replyToReview')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          }) : (
            <Card className="card-luxury">
              <CardContent className="text-center py-16">
                <Star className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-display text-xl font-semibold mb-2">{t('hostReviews.noReviews')}</h3>
                <p className="text-muted-foreground">{t('hostReviews.noReviewsDesc')}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Response Dialog */}
      <Dialog open={!!respondingReview} onOpenChange={(open) => { if (!open) setRespondingReview(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display">
              <Reply className="w-5 h-5 text-primary" />
              {respondingReview?.host_response
                ? t('hostReviews.editYourResponse')
                : t('hostReviews.replyToReview')}
            </DialogTitle>
          </DialogHeader>

          {respondingReview && (
            <div className="space-y-4">
              {/* Original review preview */}
              <div className="bg-muted/50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Avatar className="w-7 h-7">
                    <AvatarImage src={respondingReview.guest_profile?.avatar_url || ''} />
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                      {(respondingReview.guest_profile?.full_name || 'G')[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium">{respondingReview.guest_profile?.full_name || t('hostReviews.guest')}</span>
                  {renderStars(respondingReview.overall_rating)}
                </div>
                {respondingReview.comment && (
                  <p className="text-sm text-muted-foreground leading-relaxed">{respondingReview.comment}</p>
                )}
              </div>

              {/* Response input */}
              <div className="space-y-2">
                <Textarea
                  placeholder={t('hostReviews.responsePlaceholder')}
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  maxLength={1000}
                  className="min-h-[120px] resize-none"
                />
                <p className="text-xs text-muted-foreground text-right">{responseText.length}/1000</p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRespondingReview(null)} disabled={isSubmitting}>
              {t('common.cancel')}
            </Button>
            <Button onClick={submitResponse} disabled={isSubmitting || !responseText.trim()} className="gap-1.5">
              <Send className="w-4 h-4" />
              {isSubmitting ? t('common.saving') : t('hostReviews.publishResponse')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
