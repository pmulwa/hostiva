import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import {
  User, Star, Calendar, MapPin, Home, Shield, CheckCircle2,
  Crown, TrendingUp, MessageSquare, Sparkles, Bed, Lock, Globe, Heart,
  Mail, Phone, IdCard, Settings as SettingsIcon, Award,
} from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';

type Profile = Database['public']['Tables']['profiles']['Row'];

interface RatingBreakdown {
  overall: number;
  count: number;
  cleanliness: number;
  communication: number;
  security: number;
  beddings: number;
  location: number;
}

interface Review {
  id: string;
  overall_rating: number;
  comment: string | null;
  created_at: string;
  reviewer_name: string;
  reviewer_avatar: string | null;
}

function StarDisplay({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'lg' }) {
  const cls = size === 'lg' ? 'w-5 h-5' : 'w-3.5 h-3.5';
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <Star
          key={s}
          className={`${cls} ${s <= Math.round(rating) ? 'fill-rating text-rating' : 'text-muted-foreground/20'}`}
        />
      ))}
    </div>
  );
}

function RatingBar({ label, icon: Icon, value }: { label: string; icon: React.ElementType; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <span className="text-sm text-muted-foreground w-28 flex-shrink-0">{label}</span>
      <div className="flex-1 bg-muted rounded-full h-2">
        <div
          className="bg-primary rounded-full h-2 transition-all"
          style={{ width: `${(value / 5) * 100}%` }}
        />
      </div>
      <span className="text-sm font-semibold w-8 text-right">{value > 0 ? value.toFixed(1) : '—'}</span>
    </div>
  );
}

export default function PublicProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isHost, setIsHost] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [isSuperhost, setIsSuperhost] = useState(false);
  const [guestRating, setGuestRating] = useState<RatingBreakdown | null>(null);
  const [hostRating, setHostRating] = useState<RatingBreakdown | null>(null);
  const [guestReviews, setGuestReviews] = useState<Review[]>([]);
  const [hostReviews, setHostReviews] = useState<Review[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [joinDate, setJoinDate] = useState('');
  const [hostSinceDate, setHostSinceDate] = useState<string | null>(null);
  const [verifiedChannels, setVerifiedChannels] = useState<{
    email: boolean; phone: boolean; government_id: boolean; work_email: boolean;
  }>({ email: false, phone: false, government_id: false, work_email: false });
  const [completedTrips, setCompletedTrips] = useState(0);
  const [completedHostings, setCompletedHostings] = useState(0);
  const [prefs, setPrefs] = useState<{
    travel_style: string | null;
    interests: string[];
    dietary_preferences: string[];
    accessibility_needs: string[];
  } | null>(null);

  const isOwnProfile = authUser?.id === id;

  useEffect(() => {
    if (id) fetchAll(id);
  }, [id]);

  const calcBreakdown = (reviews: any[]): RatingBreakdown => {
    const n = reviews.length;
    if (n === 0) return { overall: 0, count: 0, cleanliness: 0, communication: 0, security: 0, beddings: 0, location: 0 };
    const avg = (key: string) => Math.round((reviews.reduce((s, r) => s + Number(r[key] || 0), 0) / n) * 10) / 10;
    return {
      overall: avg('overall_rating'),
      count: n,
      cleanliness: avg('cleanliness_rating'),
      communication: avg('communication_rating'),
      security: avg('security_rating'),
      beddings: avg('beddings_rating'),
      location: avg('location_rating'),
    };
  };

  const fetchAll = async (userId: string) => {
    setLoading(true);

    // Profile
    const { data: prof } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (prof) {
      setProfile(prof);
      setIsHost(prof.is_host || false);
      setIsVerified(prof.is_verified || false);
      setJoinDate(format(new Date(prof.created_at), 'MMMM yyyy'));
    }

    // Guest reviews (host reviewed this guest)
    const { data: gRevs } = await supabase
      .from('mutual_reviews')
      .select('*')
      .eq('guest_id', userId)
      .eq('reviewer_type', 'host')
      .eq('is_published', true);
    if (gRevs && gRevs.length > 0) {
      setGuestRating(calcBreakdown(gRevs));
      // Get reviewer profiles
      const hostIds = [...new Set(gRevs.map(r => r.host_id))];
      const { data: hostProfs } = await supabase.from('profiles').select('user_id, full_name, avatar_url').in('user_id', hostIds);
      const profMap = new Map(hostProfs?.map(p => [p.user_id, p]) || []);
      setGuestReviews(gRevs.filter(r => r.comment).map(r => ({
        id: r.id,
        overall_rating: Number(r.overall_rating || 0),
        comment: r.comment,
        created_at: r.created_at || '',
        reviewer_name: profMap.get(r.host_id)?.full_name || 'Host',
        reviewer_avatar: profMap.get(r.host_id)?.avatar_url || null,
      })));
    }

    // Host reviews (guest reviewed this host)
    const { data: hRevs } = await supabase
      .from('mutual_reviews')
      .select('*')
      .eq('host_id', userId)
      .eq('reviewer_type', 'guest')
      .eq('is_published', true);
    if (hRevs && hRevs.length > 0) {
      setHostRating(calcBreakdown(hRevs));
      const guestIds = [...new Set(hRevs.map(r => r.guest_id))];
      const { data: guestProfs } = await supabase.from('profiles').select('user_id, full_name, avatar_url').in('user_id', guestIds);
      const profMap = new Map(guestProfs?.map(p => [p.user_id, p]) || []);
      setHostReviews(hRevs.filter(r => r.comment).map(r => ({
        id: r.id,
        overall_rating: Number(r.overall_rating || 0),
        comment: r.comment,
        created_at: r.created_at || '',
        reviewer_name: profMap.get(r.guest_id)?.full_name || 'Guest',
        reviewer_avatar: profMap.get(r.guest_id)?.avatar_url || null,
      })));
    }

    // Superhost check
    const { data: shCriteria } = await supabase
      .from('platform_controls')
      .select('settings')
      .eq('section', 'superhost_criteria')
      .single();
    if (shCriteria && hRevs) {
      const s = (shCriteria as any).settings as { min_rating: number; min_reviews: number };
      const bd = calcBreakdown(hRevs);
      setIsSuperhost(bd.overall >= s.min_rating && bd.count >= s.min_reviews);
    }

    // Properties (active, for hosts)
    if (prof?.is_host) {
      const { data: props } = await supabase
        .from('properties')
        .select('id, title, city, country, cover_image, average_rating, total_reviews, price_per_night, currency')
        .eq('host_id', userId)
        .eq('status', 'active')
        .limit(6);
      setProperties(props || []);

      // First-listing date is a good proxy for "host since"
      const { data: firstProp } = await supabase
        .from('properties')
        .select('created_at')
        .eq('host_id', userId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (firstProp?.created_at) {
        setHostSinceDate(format(new Date(firstProp.created_at), 'MMMM yyyy'));
      }
    }

    // Verification channels (email / phone / gov ID / work email)
    const { data: vrows } = await (supabase as any)
      .from('user_verifications')
      .select('verification_type, status')
      .eq('user_id', userId);
    if (Array.isArray(vrows)) {
      const next = { email: false, phone: false, government_id: false, work_email: false };
      for (const v of vrows as any[]) {
        if (v.status === 'verified' && v.verification_type in next) {
          (next as any)[v.verification_type] = true;
        }
      }
      setVerifiedChannels(next);
    }

    // Completed bookings counts
    const { count: trips } = await supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('guest_id', userId)
      .eq('status', 'completed');
    setCompletedTrips(trips || 0);

    const { count: hostings } = await supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('host_id', userId)
      .eq('status', 'completed');
    setCompletedHostings(hostings || 0);

    // Public preferences (travel style / interests / dietary / accessibility)
    // Exposed via a SECURITY DEFINER RPC that returns ONLY these four columns.
    const { data: prefRows } = await (supabase as any).rpc('get_public_preferences', { _user_id: userId });
    const row = Array.isArray(prefRows) ? prefRows[0] : prefRows;
    if (row) {
      setPrefs({
        travel_style: row.travel_style ?? null,
        interests: row.interests ?? [],
        dietary_preferences: row.dietary_preferences ?? [],
        accessibility_needs: row.accessibility_needs ?? [],
      });
    }

    setLoading(false);
  };

  if (loading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-12 max-w-5xl">
          <div className="animate-pulse space-y-6">
            <div className="flex gap-6">
              <div className="w-28 h-28 rounded-full bg-muted" />
              <div className="space-y-3 flex-1">
                <div className="h-8 bg-muted rounded w-48" />
                <div className="h-4 bg-muted rounded w-32" />
              </div>
            </div>
            <div className="h-48 bg-muted rounded-xl" />
          </div>
        </div>
      </Layout>
    );
  }

  if (!profile) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-20 text-center">
          <Lock className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h1 className="font-display text-2xl font-bold mb-2">Profile Not Found</h1>
          <p className="text-muted-foreground">This user profile does not exist or is not accessible.</p>
        </div>
      </Layout>
    );
  }

  const ReviewCard = ({ review }: { review: Review }) => (
    <div className="flex gap-3 py-4 border-b border-border last:border-0">
      <Avatar className="w-10 h-10 flex-shrink-0">
        <AvatarImage src={review.reviewer_avatar || ''} />
        <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
          {review.reviewer_name[0]?.toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold">{review.reviewer_name}</span>
          <StarDisplay rating={review.overall_rating} />
          <span className="text-xs text-muted-foreground ml-auto">
            {review.created_at ? format(new Date(review.created_at), 'MMM yyyy') : ''}
          </span>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{review.comment}</p>
      </div>
    </div>
  );

  const RatingSection = ({ title, icon: Icon, rating, reviews }: {
    title: string; icon: React.ElementType; rating: RatingBreakdown | null; reviews: Review[];
  }) => (
    <div className="space-y-6">
      {rating ? (
        <>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Star className="w-8 h-8 fill-rating text-rating" />
              <span className="font-display text-4xl font-bold text-rating">{rating.overall}</span>
            </div>
            <div>
              <p className="text-sm font-medium">{title}</p>
              <p className="text-xs font-bold text-rating">{rating.count} review{rating.count !== 1 ? 's' : ''}</p>
            </div>
          </div>

          <div className="space-y-3">
            <RatingBar label="Cleanliness" icon={Sparkles} value={rating.cleanliness} />
            <RatingBar label="Communication" icon={MessageSquare} value={rating.communication} />
            <RatingBar label="Security" icon={Shield} value={rating.security} />
            <RatingBar label="Beddings" icon={Bed} value={rating.beddings} />
            <RatingBar label="Location" icon={MapPin} value={rating.location} />
          </div>

          {reviews.length > 0 && (
            <div className="pt-2">
              <h4 className="text-sm font-semibold mb-2">What people say</h4>
              <div className="divide-y divide-border">
                {reviews.slice(0, 5).map(r => <ReviewCard key={r.id} review={r} />)}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-8">
          <Icon className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No reviews yet {title.toLowerCase()}</p>
        </div>
      )}
    </div>
  );

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Hero Section */}
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-8">
          {/* Left - Profile Card */}
          <div className="space-y-6">
            <Card>
              <CardContent className="pt-8 pb-6 text-center">
                <Avatar className="w-28 h-28 mx-auto mb-4">
                  <AvatarImage src={profile.avatar_url || ''} />
                  <AvatarFallback className="bg-primary text-primary-foreground text-3xl font-bold">
                    {(profile.full_name || profile.email)?.[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                <h1 className="font-display text-xl font-bold">{profile.full_name || 'User'}</h1>

                {/* Badges row */}
                <div className="flex flex-wrap items-center justify-center gap-1.5 mt-2">
                  {isVerified && (
                    <Badge className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> Verified
                    </Badge>
                  )}
                  {isHost && (
                    <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">
                      <Home className="w-3 h-3 mr-1" /> Host
                    </Badge>
                  )}
                  {isSuperhost && (
                    <Badge className="bg-yellow-500/10 text-yellow-700 border-yellow-500/20 text-xs">
                      <Crown className="w-3 h-3 mr-1" /> Superhost
                    </Badge>
                  )}
                </div>

                <p className="text-sm text-muted-foreground flex items-center justify-center gap-1.5 mt-3">
                  <Calendar className="w-3.5 h-3.5" />
                  Joined {joinDate}
                </p>
                {isHost && hostSinceDate && (
                  <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5 mt-1">
                    <Home className="w-3 h-3" />
                    Hosting since {hostSinceDate}
                  </p>
                )}

                {profile.location && (
                  <p className="text-sm text-muted-foreground flex items-center justify-center gap-1 mt-1">
                    <MapPin className="w-3.5 h-3.5" />
                    {profile.location}
                  </p>
                )}

                {isOwnProfile && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4 gap-1.5"
                    onClick={() => navigate('/profile')}
                  >
                    <SettingsIcon className="w-3.5 h-3.5" /> Edit profile
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Quick Stats — guest-only metrics (trips + guest rating) */}
            {!isHost && (
              <Card>
                <CardContent className="py-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Completed Trips</span>
                    <span className="font-bold">{completedTrips}</span>
                  </div>
                  {guestRating && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Guest Rating Received</span>
                      <div className="flex items-center gap-1">
                        <Star className="w-4 h-4 fill-rating text-rating" />
                        <span className="font-bold text-rating">{guestRating.overall}</span>
                        <span className="text-xs font-bold text-rating">({guestRating.count})</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Host stats — listings, hostings, host rating */}
            {isHost && (
              <Card>
                <CardContent className="py-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Active Listings</span>
                    <span className="font-bold">{properties.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Guests Hosted</span>
                    <span className="font-bold">{completedHostings}</span>
                  </div>
                  {hostRating && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Host Rating</span>
                      <div className="flex items-center gap-1">
                        <Star className="w-4 h-4 fill-rating text-rating" />
                        <span className="font-bold text-rating">{hostRating.overall}</span>
                        <span className="text-xs font-bold text-rating">({hostRating.count})</span>
                      </div>
                    </div>
                  )}
                  {isSuperhost && (
                    <div className="flex items-center justify-between pt-2 border-t border-border">
                      <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                        <Award className="w-4 h-4 text-yellow-500" /> Achievement
                      </span>
                      <Badge className="bg-yellow-500/10 text-yellow-700 border-yellow-500/20">
                        <Crown className="w-3 h-3 mr-1" /> Superhost
                      </Badge>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Verification badges — show for hosts (trust matters most when booking) */}
            {isHost && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Shield className="w-4 h-4" /> Host verifications
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {[
                    { key: 'email', label: 'Email verified', icon: Mail, ok: verifiedChannels.email },
                    { key: 'phone', label: 'Phone verified', icon: Phone, ok: verifiedChannels.phone },
                    { key: 'government_id', label: 'Government ID verified', icon: IdCard, ok: verifiedChannels.government_id },
                  ].map((v) => (
                    <div key={v.key} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <v.icon className="w-3.5 h-3.5" /> {v.label}
                      </span>
                      {v.ok ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      ) : (
                        <span className="text-xs text-muted-foreground">Not verified</span>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Bio */}
            {profile.bio && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {isHost ? 'About me as host' : 'About me'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed">{profile.bio}</p>
                </CardContent>
              </Card>
            )}

            {/* Travel Style & Preferences — guest-only context. Hidden for hosts
                because the host card focuses on trust signals & listings, not
                personal travel taste. */}
            {!isHost && prefs && (prefs.travel_style || prefs.interests.length > 0 ||
              prefs.dietary_preferences.length > 0 || prefs.accessibility_needs.length > 0) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    Travel preferences
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {prefs.travel_style && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5">Travel style</p>
                      <Badge variant="secondary" className="capitalize">{prefs.travel_style}</Badge>
                    </div>
                  )}
                  {prefs.interests.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5">Interests</p>
                      <div className="flex flex-wrap gap-1.5">
                        {prefs.interests.map(i => (
                          <Badge key={i} variant="outline" className="text-xs">{i}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {prefs.dietary_preferences.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
                        <Heart className="w-3 h-3" /> Dietary
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {prefs.dietary_preferences.map(d => (
                          <Badge key={d} variant="outline" className="text-xs">🍽 {d}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {prefs.accessibility_needs.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5">Accessibility</p>
                      <div className="flex flex-wrap gap-1.5">
                        {prefs.accessibility_needs.map(a => (
                          <Badge key={a} variant="outline" className="text-xs">{a}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right - Reviews & Listings */}
          <div>
            <Tabs defaultValue={isHost ? 'host-reviews' : 'guest-reviews'}>
              <TabsList className={`mb-6 ${isHost ? 'grid grid-cols-3' : ''}`}>
                <TabsTrigger value="guest-reviews" className="flex items-center gap-1.5">
                  <User className="w-4 h-4" />
                  Guest Reviews
                  {guestRating && <span className="text-xs opacity-70">({guestRating.count})</span>}
                </TabsTrigger>
                {isHost && (
                  <>
                    <TabsTrigger value="host-reviews" className="flex items-center gap-1.5">
                      <Home className="w-4 h-4" />
                      Host Reviews
                      {hostRating && <span className="text-xs opacity-70">({hostRating.count})</span>}
                    </TabsTrigger>
                    <TabsTrigger value="listings" className="flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4" />
                      Listings
                      <span className="text-xs opacity-70">({properties.length})</span>
                    </TabsTrigger>
                  </>
                )}
              </TabsList>

              <TabsContent value="guest-reviews">
                <Card>
                  <CardContent className="p-6">
                    <RatingSection title="as a guest" icon={User} rating={guestRating} reviews={guestReviews} />
                  </CardContent>
                </Card>
              </TabsContent>

              {isHost && (
                <>
                  <TabsContent value="host-reviews">
                    <Card>
                      <CardContent className="p-6">
                        <RatingSection title="as a host" icon={Home} rating={hostRating} reviews={hostReviews} />
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="listings">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {properties.length > 0 ? properties.map(prop => (
                        <Link to={`/property/${prop.id}`} key={prop.id}>
                          <Card className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer">
                            <div className="aspect-[16/10] overflow-hidden">
                              <img
                                src={prop.cover_image || '/placeholder.svg'}
                                alt={prop.title}
                                className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                              />
                            </div>
                            <CardContent className="p-4">
                              <h3 className="font-semibold text-sm truncate">{prop.title}</h3>
                              <p className="text-xs text-muted-foreground">{prop.city}, {prop.country}</p>
                              <div className="flex items-center justify-between mt-2">
                                <span className="text-sm font-extrabold text-rating">{prop.currency || '$'}{prop.price_per_night}<span className="text-xs font-normal text-rating/80">/night</span></span>
                                {prop.average_rating > 0 && (
                                  <div className="flex items-center gap-1 text-xs text-rating font-bold">
                                    <Star className="w-3 h-3 fill-rating text-rating" />
                                    {Number(prop.average_rating).toFixed(1)}
                                    <span className="text-rating">({prop.total_reviews})</span>
                                  </div>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        </Link>
                      )) : (
                        <div className="col-span-2 text-center py-12">
                          <Home className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                          <p className="text-sm text-muted-foreground">No active listings</p>
                        </div>
                      )}
                    </div>
                  </TabsContent>
                </>
              )}
            </Tabs>
          </div>
        </div>
      </div>
    </Layout>
  );
}
