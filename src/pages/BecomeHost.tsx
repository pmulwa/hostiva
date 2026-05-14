import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Slider } from '@/components/ui/slider';
import {
  Home, Shield, ShieldCheck, Users, MessageCircle, Globe,
  ArrowRight, Check, Star, Clock, ChevronRight, Medal,
  Smartphone, Camera, CalendarCheck, Banknote, TrendingUp,
  Zap, BadgeCheck, HeartHandshake, Sparkles, Layers, Lock, AlertCircle
} from 'lucide-react';
import heroImage from '@/assets/host-home-banner.jpg';
import { usePlatformControls } from '@/hooks/usePlatformControls';

// The 8 mandatory items a user must complete before becoming a host.
// 4 verification documents (resolved via `user_verifications`) + 4 profile
// fields (resolved against `profiles`). The "List your property" button stays
// disabled until ALL 8 are satisfied (8/8). Each item links the host to the
// exact place to complete it.
type HostRequirement =
  | { kind: 'verification'; key: string; label: string }
  | { kind: 'profile'; key: 'full_name' | 'avatar_url' | 'phone' | 'bio' | 'location'; label: string };

const HOST_REQUIREMENTS: HostRequirement[] = [
  { kind: 'verification', key: 'government_id', label: 'Government-issued ID' },
  { kind: 'verification', key: 'email',         label: 'Email address verified' },
  { kind: 'verification', key: 'phone',         label: 'Phone number verified' },
  { kind: 'verification', key: 'work_email',    label: 'Work / secondary email verified' },
  { kind: 'profile',      key: 'full_name',     label: 'Full legal name on profile' },
  { kind: 'profile',      key: 'avatar_url',    label: 'Profile photo uploaded' },
  { kind: 'profile',      key: 'bio',           label: 'About-you bio (min. 30 characters)' },
  { kind: 'profile',      key: 'location',      label: 'Home location on profile' },
];
const TOTAL_REQUIREMENTS = HOST_REQUIREMENTS.length; // 8

export default function BecomeHost() {
  const { t } = useTranslation();
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [nightsPerMonth, setNightsPerMonth] = useState(15);
  const [nightlyRate, setNightlyRate] = useState(120);
  const [verifStatuses, setVerifStatuses] = useState<Record<string, string>>({});
  const { controls: platformControls } = usePlatformControls();
  // Admin Controls: property_approvals.require_id_verification — when OFF,
  // hosts can list without a government ID on file.
  const idRequired = platformControls.property_approvals.require_id_verification !== false;

  const grossEarnings = nightsPerMonth * nightlyRate;
  const hostFee = grossEarnings * 0.03;
  const monthlyEarnings = grossEarnings - hostFee;
  const annualEarnings = monthlyEarnings * 12;

  useEffect(() => {
    if (!user) return;
    supabase
      .from('user_verifications')
      .select('verification_type, status')
      .eq('user_id', user.id)
      .in(
        'verification_type',
        HOST_REQUIREMENTS.filter(r => r.kind === 'verification').map(r => r.key),
      )
      .then(({ data }) => {
        const map: Record<string, string> = {};
        (data || []).forEach((v: { verification_type: string; status: string }) => {
          map[v.verification_type] = v.status;
        });
        setVerifStatuses(map);
      });
  }, [user]);

  // Per-requirement completeness. Email is also satisfied by Supabase's own
  // confirmed-email flag, so users who signed up via the standard email flow
  // don't have to re-verify it inside the verifications table.
  const isRequirementMet = (req: HostRequirement): boolean => {
    if (req.kind === 'verification') {
      if (req.key === 'email') {
        return (
          verifStatuses['email'] === 'verified' ||
          !!(user as { email_confirmed_at?: string | null } | null)?.email_confirmed_at
        );
      }
      return verifStatuses[req.key] === 'verified';
    }
    const value = (profile as Record<string, unknown> | null)?.[req.key];
    if (req.key === 'bio') return typeof value === 'string' && value.trim().length >= 30;
    return typeof value === 'string' && value.trim().length > 0;
  };

  const completedCount = HOST_REQUIREMENTS.filter(isRequirementMet).length;
  // Admin override: if ID verification is globally disabled we still require
  // the 7 non-ID items, but treat the ID slot as auto-met.
  const effectiveCompleted = idRequired
    ? completedCount
    : completedCount + (isRequirementMet({ kind: 'verification', key: 'government_id', label: '' }) ? 0 : 1);
  const isFullyVerified = effectiveCompleted >= TOTAL_REQUIREMENTS;

  const handleBecomeHost = async () => {
    if (!user) {
      navigate('/auth');
      return;
    }

    if (!isFullyVerified) {
      toast({
        title: 'Verification required',
        description: `You must complete all ${TOTAL_REQUIREMENTS} host requirements (${effectiveCompleted}/${TOTAL_REQUIREMENTS} done) before listing a property.`,
        variant: 'destructive',
      });
      navigate('/profile?tab=host');
      return;
    }

    setIsLoading(true);

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ is_host: true })
      .eq('user_id', user.id);

    if (profileError) {
      toast({
        title: 'Error',
        description: profileError.message,
        variant: 'destructive',
      });
      setIsLoading(false);
      return;
    }

    const { error: roleError } = await supabase
      .from('user_roles')
      .insert({ user_id: user.id, role: 'host' })
      .select()
      .single();

    if (roleError && !roleError.message.includes('duplicate')) {
      console.error('Role error:', roleError);
    }

    await refreshProfile();

    toast({
      title: t('becomeHost.welcomeHost'),
      description: t('becomeHost.welcomeHostDesc'),
    });

    navigate('/host/properties/new');
    setIsLoading(false);
  };

  return (
    <Layout>
      {/* Hostly legacy theme — scoped to this page only.
          Overrides primary tokens to the original coral/pink (#FF385C)
          without affecting any other page in the app. */}
      <div
        style={{
          // HSL values for #FF385C and supporting tints
          ['--primary' as any]: '351 100% 61%',
          ['--primary-foreground' as any]: '0 0% 100%',
          ['--ring' as any]: '351 100% 61%',
          ['--pink' as any]: '351 100% 61%',
          ['--pink-light' as any]: '351 100% 96%',
          ['--pink-dark' as any]: '351 80% 45%',
        }}
      >
      {/* Hero Section */}
      <section className="relative min-h-[520px] flex items-center overflow-hidden">
        <div className="absolute inset-0">
          <img src={heroImage} alt="Beautiful home interior" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-foreground/90 via-foreground/75 to-foreground/40" />
        </div>

        <div className="container mx-auto px-4 relative z-10 py-20">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 bg-primary text-primary-foreground text-sm font-semibold px-4 py-2 rounded-full mb-6">
              <Home className="w-4 h-4" />
              List your property
            </span>

            <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6 leading-tight">
              Turn your space into{' '}
              <span className="text-primary">income</span>
            </h1>

            <p className="text-white/90 text-lg md:text-xl leading-relaxed max-w-lg">
              Join thousands of hosts on Hostly and start earning from your property. Set your own schedule, rates, and house rules.
            </p>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="bg-foreground py-10">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { value: '$3,200', label: 'Avg. host earns / month', accent: true },
              { value: '4M+', label: 'Active listings worldwide', accent: false },
              { value: '3%', label: 'Lowest host fee', accent: true },
              { value: '24h', label: 'First payout after check-in', accent: false },
            ].map((stat, i) => (
              <div key={i} className="group">
                <p className={`text-3xl md:text-4xl font-bold mb-1 ${stat.accent ? 'text-primary' : 'text-white'}`}>
                  {stat.value}
                </p>
                <p className="text-sm text-white/60">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works - Infographic Timeline */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <span className="inline-block bg-primary/10 text-primary text-xs font-bold px-3 py-1 rounded-full mb-4 tracking-wider uppercase">
              How It Works
            </span>
            <h2 className="font-display text-3xl md:text-5xl font-bold mb-4">
              Start hosting in <span className="text-primary">4 simple steps</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              From sign-up to your first booking — we make the process seamless
            </p>
          </div>

          <div className="max-w-5xl mx-auto">
            <div className="grid md:grid-cols-4 gap-0 relative">
              {/* Connecting line */}
              <div className="hidden md:block absolute top-16 left-[12.5%] right-[12.5%] h-0.5 bg-gradient-to-r from-primary via-primary/60 to-primary/30" />

              {[
                { step: 1, icon: Smartphone, title: 'Sign up & verify', desc: 'Create your account and complete identity verification in minutes', color: 'bg-primary' },
                { step: 2, icon: Camera, title: 'Create your listing', desc: 'Add stunning photos, write descriptions, and set your house rules', color: 'bg-primary/80' },
                { step: 3, icon: CalendarCheck, title: 'Set availability', desc: 'Choose your dates, pricing, and booking preferences', color: 'bg-primary/60' },
                { step: 4, icon: Banknote, title: 'Start earning', desc: 'Welcome guests and receive payouts directly to your bank', color: 'bg-primary/40' },
              ].map((item) => (
                <div key={item.step} className="flex flex-col items-center text-center px-4 mb-8 md:mb-0">
                  <div className={`w-14 h-14 rounded-2xl ${item.color} flex items-center justify-center mb-5 relative z-10 shadow-lg`}>
                    <item.icon className="w-7 h-7 text-primary-foreground" />
                  </div>
                  <span className="text-xs font-bold text-primary mb-2">STEP {item.step}</span>
                  <h3 className="font-display text-lg font-bold mb-2">{item.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Earnings Calculator Section */}
      <section className="py-24 bg-secondary/30">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-16 items-center max-w-5xl mx-auto">
            {/* Left - Text */}
            <div>
              <span className="inline-block bg-green-100 text-green-700 text-xs font-bold px-3 py-1 rounded-full mb-4 tracking-wider uppercase">
                Earnings
              </span>
              <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">
                How much could you earn?
              </h2>
              <p className="text-muted-foreground text-lg mb-8 leading-relaxed">
                Hostly charges one of the lowest host fees in the industry — just 3%. Guests pay a separate service fee, so your earnings stay high.
              </p>

              {/* Mini infographic cards */}
              <div className="grid grid-cols-2 gap-4 mb-8">
                {[
                  { icon: TrendingUp, value: '97%', label: 'You keep', sub: 'of every booking' },
                  { icon: Zap, value: '<24h', label: 'Payout speed', sub: 'after check-in' },
                ].map((item, i) => (
                  <div key={i} className="bg-background rounded-xl p-4 border">
                    <item.icon className="w-5 h-5 text-primary mb-2" />
                    <p className="text-2xl font-bold text-foreground">{item.value}</p>
                    <p className="text-sm font-semibold text-foreground">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.sub}</p>
                  </div>
                ))}
              </div>

              <ul className="space-y-3">
                {[
                  'Set your own nightly rate',
                  'Weekly & monthly discounts to attract longer stays',
                  'Smart pricing suggestions powered by AI',
                  'Cleaning fee and extra guest fees under your control',
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                      <Check className="w-3.5 h-3.5 text-green-600" />
                    </div>
                    <span className="text-foreground text-sm">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Right - Calculator */}
            <Card className="border shadow-xl rounded-2xl overflow-hidden">
              <div className="bg-foreground px-6 py-4">
                <h3 className="font-display text-lg font-bold text-white">Earnings Calculator</h3>
                <p className="text-white/60 text-sm">Estimate your monthly income as a Hostly host</p>
              </div>
              <CardContent className="p-6 space-y-6">
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="font-semibold text-sm">Nights per month</span>
                    <span className="text-primary font-bold text-sm">{nightsPerMonth} nights</span>
                  </div>
                  <Slider
                    value={[nightsPerMonth]}
                    onValueChange={(v) => setNightsPerMonth(v[0])}
                    min={1}
                    max={30}
                    step={1}
                    className="mb-1"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>1</span>
                    <span>30</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between mb-2">
                    <span className="font-semibold text-sm">Nightly rate (USD)</span>
                    <span className="text-primary font-bold text-sm">${nightlyRate}</span>
                  </div>
                  <Slider
                    value={[nightlyRate]}
                    onValueChange={(v) => setNightlyRate(v[0])}
                    min={20}
                    max={1000}
                    step={10}
                    className="mb-1"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>$20</span>
                    <span>$1,000</span>
                  </div>
                </div>

                <div className="border-t pt-4 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Gross earnings</span>
                    <span className="font-semibold">${grossEarnings.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Hostly host fee (3%)</span>
                    <span className="text-primary font-semibold">-${hostFee.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xl font-bold border-t pt-3">
                    <span>Your monthly earnings</span>
                    <span className="text-green-600">${monthlyEarnings.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                  </div>
                </div>

                <div className="bg-green-50 rounded-xl p-5 text-center border border-green-200">
                  <p className="text-sm text-muted-foreground mb-1">Projected annual earnings</p>
                  <p className="text-3xl font-bold text-green-600">${annualEarnings.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                  <p className="text-xs text-muted-foreground mt-1">Based on your settings above</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Why Hosts Love Hostly - Infographic Grid */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <span className="inline-block bg-primary/10 text-primary text-xs font-bold px-3 py-1 rounded-full mb-4 tracking-wider uppercase">
              Why Hostly
            </span>
            <h2 className="font-display text-3xl md:text-5xl font-bold mb-4">
              Built for hosts, by <span className="text-primary">hosts</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Everything you need to succeed as a host — tools, support, and a platform that puts you first
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              {
                icon: Sparkles,
                title: 'AI-Powered Tools',
                desc: 'Smart pricing, automated responses, and personalized insights to maximize your earnings.',
                highlight: 'Boost bookings by 40%',
                color: 'bg-purple-50 text-purple-600',
              },
              {
                icon: Layers,
                title: 'Multi-Property Management',
                desc: 'Manage all your listings from a single dashboard. Sync calendars and automate tasks.',
                highlight: 'Unlimited listings',
                color: 'bg-blue-50 text-blue-600',
              },
              {
                icon: HeartHandshake,
                title: 'Community & Support',
                desc: 'Connect with other hosts, attend workshops, and get 24/7 priority support.',
                highlight: '4M+ host community',
                color: 'bg-pink-50 text-pink-600',
              },
              {
                icon: BadgeCheck,
                title: 'Trust & Safety',
                desc: 'Verified guests, secure Paystack payments, and platform tools to help you manage every booking.',
                highlight: 'Verified guests',
                color: 'bg-green-50 text-green-600',
              },
              {
                icon: TrendingUp,
                title: 'Performance Analytics',
                desc: 'Track occupancy, revenue, and guest satisfaction with real-time dashboards and reports.',
                highlight: 'Real-time insights',
                color: 'bg-orange-50 text-orange-600',
              },
              {
                icon: Banknote,
                title: 'Fast & Flexible Payouts',
                desc: 'Get paid within 24 hours of check-in. Choose your payout method and currency.',
                highlight: '190+ currencies',
                color: 'bg-emerald-50 text-emerald-600',
              },
            ].map((item, i) => (
              <Card key={i} className="group border shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
                <CardContent className="p-6">
                  <div className={`w-12 h-12 rounded-xl ${item.color} flex items-center justify-center mb-4`}>
                    <item.icon className="w-6 h-6" />
                  </div>
                  <h3 className="font-display text-lg font-bold mb-2">{item.title}</h3>
                  <p className="text-muted-foreground text-sm mb-4 leading-relaxed">{item.desc}</p>
                  <span className={`inline-block text-xs font-bold px-3 py-1 rounded-full ${item.color}`}>
                    {item.highlight}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Superhost Program */}
      <section className="py-24 bg-secondary/30">
        <div className="container mx-auto px-4">
          <div className="text-center mb-14">
            <span className="inline-block bg-yellow-100 text-yellow-700 text-xs font-bold px-3 py-1 rounded-full mb-4 tracking-wider uppercase">
              Superhost Program
            </span>
            <h2 className="font-display text-3xl md:text-5xl font-bold mb-4">
              Unlock <span className="text-yellow-500">Superhost</span> status
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Superhosts are our most experienced, highly-rated hosts. Earn the badge and unlock exclusive benefits.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* Criteria */}
            <Card className="border shadow-sm">
              <CardContent className="p-8">
                <div className="flex items-center gap-3 mb-8">
                  <Medal className="w-7 h-7 text-yellow-500" />
                  <h3 className="font-display text-xl font-bold">Criteria to qualify</h3>
                </div>
                <div className="space-y-6">
                  {[
                    { icon: Star, title: '4.8+ overall rating', desc: 'Maintained over the past year', color: 'text-yellow-500 bg-yellow-50' },
                    { icon: Clock, title: '90% response rate', desc: 'Reply within 24 hours', color: 'text-blue-500 bg-blue-50' },
                    { icon: Check, title: '10+ stays per year', desc: 'Or 100 nights on 3+ trips', color: 'text-green-500 bg-green-50' },
                    { icon: ShieldCheck, title: '<1% cancellation rate', desc: 'Excluding extenuating circumstances', color: 'text-teal-500 bg-teal-50' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-4">
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${item.color}`}>
                        <item.icon className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-bold text-sm">{item.title}</p>
                        <p className="text-muted-foreground text-sm">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Benefits */}
            <Card className="border shadow-sm bg-yellow-50/40">
              <CardContent className="p-8">
                <div className="flex items-center gap-3 mb-8">
                  <Star className="w-7 h-7 text-yellow-500 fill-yellow-500" />
                  <h3 className="font-display text-xl font-bold">Superhost benefits</h3>
                </div>
                <div className="space-y-6">
                  {[
                    { icon: '🏅', title: 'Superhost badge', desc: 'Stand out in search results' },
                    { icon: '📈', title: 'Priority placement', desc: 'Appear higher in search' },
                    { icon: '🎁', title: 'Exclusive rewards', desc: 'Travel coupons and cash bonuses' },
                    { icon: '📞', title: 'Dedicated support', desc: 'Priority customer service line' },
                    { icon: '📊', title: 'Advanced analytics', desc: 'Deep insights into performance' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-4">
                      <span className="text-2xl flex-shrink-0 leading-none">{item.icon}</span>
                      <div>
                        <p className="font-bold text-sm">{item.title}</p>
                        <p className="text-muted-foreground text-sm">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Assessment Banner */}
          <div className="max-w-4xl mx-auto mt-10">
            <div className="bg-foreground rounded-2xl px-8 py-6 flex flex-col md:flex-row items-center justify-between gap-4">
              <div>
                <p className="font-bold text-lg text-white">Superhost assessment happens every 3 months</p>
                <p className="text-sm text-white/60">Maintain your stats and the badge is yours to keep</p>
              </div>
              <Button
                variant="outline"
                className="border-primary text-primary bg-white hover:bg-primary hover:text-white whitespace-nowrap font-semibold"
                onClick={() => {
                  const ctaSection = document.getElementById('cta-section');
                  ctaSection?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                Start your journey <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Host Responsibility */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="text-center mb-14">
            <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold px-3 py-1 rounded-full mb-4 tracking-wider uppercase">
              Host Responsibility
            </span>
            <h2 className="font-display text-3xl md:text-5xl font-bold mb-4">
              Host <span className="text-amber-600">independently</span>
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Every Hostly host operates as an independent business. We provide the marketplace and tools — you protect your property with your own insurance.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            {[
              { icon: Users, title: 'Guest Screening', desc: 'All guests are verified with ID before they can book.', color: 'bg-indigo-50 text-indigo-600' },
              { icon: MessageCircle, title: '24/7 Support', desc: 'Our team is here to help mediate communication and resolve disputes.', color: 'bg-violet-50 text-violet-600' },
              { icon: Shield, title: 'Secure Payments', desc: 'Paystack-powered checkout, protected payouts, and full transaction records.', color: 'bg-blue-50 text-blue-600' },
              { icon: Globe, title: 'Bring Your Own Insurance', desc: 'Hosts are advised to carry short-term rental insurance for damage and liability.', color: 'bg-sky-50 text-sky-600' },
            ].map((item, i) => (
              <Card key={i} className="border shadow-sm text-center group hover:shadow-lg transition-shadow duration-300">
                <CardContent className="p-8">
                  <div className={`w-16 h-16 mx-auto mb-5 rounded-2xl ${item.color} flex items-center justify-center`}>
                    <item.icon className="w-8 h-8" />
                  </div>
                  <h3 className="font-bold text-lg mb-2">{item.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Insurance Notice Banner */}
          <div className="max-w-5xl mx-auto mt-10">
            <div className="border-2 border-amber-300 rounded-2xl px-8 py-6 flex flex-col md:flex-row items-center gap-6 bg-amber-50">
              <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                <Shield className="w-7 h-7 text-amber-600" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-lg">Hostly does not provide damage insurance</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Hostly is a marketplace and does not guarantee protection against guest-caused damage. Every host is strongly advised to obtain their own short-term rental insurance covering property damage, liability, and loss of income.
                </p>
              </div>
              <Button variant="outline" size="sm" className="whitespace-nowrap border-amber-400 text-amber-700 hover:bg-amber-100 font-semibold" onClick={() => navigate('/host-guarantee')}>
                Read guidance
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section id="cta-section" className="py-24">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto bg-primary/5 rounded-3xl py-20 px-8 text-center relative overflow-hidden">
            {/* Decorative dots */}
            <div className="absolute top-6 left-6 w-20 h-20 rounded-full bg-primary/5" />
            <div className="absolute bottom-6 right-6 w-32 h-32 rounded-full bg-primary/5" />

            <div className="relative z-10">
              <div className="w-18 h-18 mx-auto mb-8 rounded-full bg-primary flex items-center justify-center w-[72px] h-[72px] shadow-lg">
                <Home className="w-9 h-9 text-primary-foreground" />
              </div>
              <h2 className="font-display text-3xl md:text-5xl font-bold mb-4">
                Ready to start hosting?
              </h2>
              <p className="text-muted-foreground text-lg mb-8 max-w-md mx-auto">
                It takes just 10 minutes to set up your listing and start earning. Your first guest could be booking tonight.
              </p>

              {/* Verification Status Panel — only shown when not fully verified */}
              {user && !isFullyVerified && (
                <div className="max-w-md mx-auto mb-8 bg-background border-2 border-amber-300 rounded-2xl p-5 text-left">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                    <p className="font-bold text-sm">
                      Host verification required ({effectiveCompleted}/{TOTAL_REQUIREMENTS})
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground mb-4">
                    For everyone's safety, we require all {TOTAL_REQUIREMENTS} host
                    requirements to be filled before you can list a property.
                  </p>
                  <ul className="space-y-2 mb-4">
                    {HOST_REQUIREMENTS.map(r => {
                      const verified = isRequirementMet(r);
                      const pending = r.kind === 'verification' && verifStatuses[r.key] === 'pending';
                      return (
                        <li key={`${r.kind}:${r.key}`} className="flex items-center justify-between gap-3 text-sm">
                          <span className="flex items-center gap-2">
                            {verified ? (
                              <Check className="w-4 h-4 text-green-600" />
                            ) : pending ? (
                              <Clock className="w-4 h-4 text-amber-600" />
                            ) : (
                              <Lock className="w-4 h-4 text-muted-foreground" />
                            )}
                            {r.label}
                          </span>
                          <span className={`text-xs font-semibold ${verified ? 'text-green-600' : pending ? 'text-amber-600' : 'text-muted-foreground'}`}>
                            {verified ? 'Done' : pending ? 'Pending review' : 'Missing'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => navigate('/profile?tab=host')}
                  >
                    Complete my host profile
                  </Button>
                </div>
              )}

              <Button
                size="lg"
                className="text-lg px-10 py-6 rounded-full shadow-lg hover:shadow-xl transition-shadow"
                onClick={handleBecomeHost}
                disabled={isLoading || (!!user && !isFullyVerified)}
              >
                {!user ? 'Sign in to start' : !isFullyVerified ? (
                  <><Lock className="w-5 h-5 mr-2" /> Verification required</>
                ) : isLoading ? 'Setting up...' : (
                  <>List your property <ArrowRight className="w-5 h-5 ml-2" /></>
                )}
              </Button>
              <p className="text-sm text-muted-foreground mt-5">
                Free to list · No subscription fees · Admin reviews documents in 1–3 business days
              </p>
            </div>
          </div>
        </div>
      </section>
      </div>
    </Layout>
  );
}