import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { Mail, Phone, Star, CalendarDays, Lock, ExternalLink, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partnerId: string;
  /**
   * If true, full contact details (email + phone) are revealed because the
   * conversation has an active (confirmed) booking. Otherwise only the
   * minimal profile card (name, rating, joined) is shown.
   */
  isActive: boolean;
};

type FullProfile = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  email: string;
  phone: string | null;
  bio: string | null;
  location: string | null;
  is_verified: boolean | null;
  created_at: string;
};

export function MessagesProfileDialog({ open, onOpenChange, partnerId, isActive }: Props) {
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [reviewCount, setReviewCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !partnerId) return;
    let cancelled = false;
    setLoading(true);
    // Reset previous state so a stale render never bleeds across two opens
    setProfile(null);
    setAvgRating(null);
    setReviewCount(0);
    (async () => {
      const [{ data: p, error: pErr }, { data: reviews }] = await Promise.all([
        supabase
          .from('profiles')
          .select('user_id, full_name, avatar_url, email, phone, bio, location, is_verified, created_at')
          .eq('user_id', partnerId)
          .maybeSingle(),
        supabase
          .from('mutual_reviews')
          .select('overall_rating')
          .or(`guest_id.eq.${partnerId},host_id.eq.${partnerId}`)
          .eq('is_published', true)
          .not('overall_rating', 'is', null),
      ]);
      if (cancelled) return;
      // Always render *something*. If the profile row is missing (e.g. legacy
      // guest accounts), fall back to a minimal stub so the dialog isn't stuck
      // on the loading skeleton forever.
      if (p) {
        setProfile(p as FullProfile);
      } else {
        setProfile({
          user_id: partnerId,
          full_name: null,
          avatar_url: null,
          email: '',
          phone: null,
          bio: null,
          location: null,
          is_verified: false,
          created_at: new Date().toISOString(),
        });
      }
      if (reviews && reviews.length > 0) {
        const total = reviews.reduce((s, r: any) => s + Number(r.overall_rating || 0), 0);
        setAvgRating(total / reviews.length);
        setReviewCount(reviews.length);
      } else {
        setAvgRating(null);
        setReviewCount(0);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, partnerId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="sr-only">Profile</DialogTitle>
        </DialogHeader>

        {loading || !profile ? (
          <div className="py-10 flex items-center justify-center">
            <div className="w-20 h-20 rounded-full bg-muted animate-pulse" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Header — avatar, name, rating, joined */}
            <div className="flex flex-col items-center text-center">
              <Avatar className="w-20 h-20 border-4 border-primary/10 mb-3">
                <AvatarImage src={profile.avatar_url || ''} />
                <AvatarFallback className="bg-primary/10 text-primary font-bold text-2xl">
                  {(profile.full_name || profile.email)?.[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-bold">{profile.full_name || 'User'}</h2>
                {profile.is_verified && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 gap-1">
                    <ShieldCheck className="w-3 h-3" /> Verified
                  </Badge>
                )}
              </div>
              {/* Rating */}
              <div className="flex items-center gap-3 mt-2 text-sm">
                {avgRating !== null ? (
                  <span className="flex items-center gap-1">
                    <Star className="w-4 h-4 fill-rating text-rating" />
                    <span className="font-semibold">{avgRating.toFixed(1)}</span>
                    <span className="text-muted-foreground text-xs">({reviewCount})</span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">No reviews yet</span>
                )}
                <span className="text-muted-foreground/40">·</span>
                <span className="flex items-center gap-1 text-muted-foreground text-xs">
                  <CalendarDays className="w-3.5 h-3.5" />
                  Joined {format(new Date(profile.created_at), 'MMM yyyy')}
                </span>
              </div>
            </div>

            {/* Contact details — only when conversation is active */}
            {isActive ? (
              <>
                <Separator />
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Contact</p>
                  <a
                    href={`mailto:${profile.email}`}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border hover:bg-muted/50 transition-colors group"
                  >
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Mail className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Email</p>
                      <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                        {profile.email}
                      </p>
                    </div>
                  </a>
                  {profile.phone ? (
                    <a
                      href={`tel:${profile.phone}`}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border hover:bg-muted/50 transition-colors group"
                    >
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Phone className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Mobile</p>
                        <p className="text-sm font-medium group-hover:text-primary transition-colors">
                          {profile.phone}
                        </p>
                      </div>
                    </a>
                  ) : (
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-dashed border-border/60 text-muted-foreground">
                      <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <Phone className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wider">Mobile</p>
                        <p className="text-sm italic">Not provided</p>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <Separator />
                <div className="flex items-start gap-3 rounded-lg bg-muted/40 border border-border/60 p-3">
                  <Lock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="text-xs text-muted-foreground">
                    <p className="font-semibold text-foreground mb-0.5">Contact details hidden</p>
                    <p>Email and mobile number are only shared while a booking is active. They are hidden once the booking is cancelled or completed.</p>
                  </div>
                </div>
              </>
            )}

            {/* View public profile */}
            <Button asChild variant="outline" className="w-full gap-2">
              <Link to={`/user/${profile.user_id}`}>
                <ExternalLink className="w-4 h-4" />
                View full public profile
              </Link>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
