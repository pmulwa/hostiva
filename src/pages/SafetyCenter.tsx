import { useEffect, useState } from 'react';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Shield, AlertTriangle, MessageCircleWarning, Globe, Lock, FileCheck, Users, Heart } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

interface ForceMajeureEvent {
  id: string;
  title: string;
  description: string | null;
  event_type: string;
  affected_country: string;
  affected_region: string | null;
  affected_cities: string[];
  starts_at: string;
  ends_at: string;
  host_compensation_pct: number;
  source_reference: string | null;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  natural_disaster: 'Natural Disaster',
  pandemic: 'Pandemic / Health',
  political_unrest: 'Political Unrest',
  travel_ban: 'Travel Ban',
  weather: 'Severe Weather',
  other: 'Other',
};

export default function SafetyCenter() {
  const [events, setEvents] = useState<ForceMajeureEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Safety Center | Hostiva';
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', 'Hostiva Safety Center: active travel advisories, anti-fraud rules, and trust & safety protections for guests and hosts.');

    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from('force_majeure_events')
        .select('*')
        .eq('is_active', true)
        .lte('starts_at', today)
        .gte('ends_at', today)
        .order('starts_at', { ascending: false });
      setEvents((data as ForceMajeureEvent[]) || []);
      setLoading(false);
    })();
  }, []);

  return (
    <Layout>
      <div className="container mx-auto px-4 md:px-6 py-12 max-w-5xl">
        {/* Hero */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-bold tracking-tight mb-4">
            Safety Center
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            How we keep guests and hosts safe — active travel advisories, fraud protections, and the rules that make Hostiva a place you can trust.
          </p>
        </div>

        {/* Active Force Majeure */}
        <section className="mb-12">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-primary" />
            <h2 className="text-2xl font-display font-bold">Active Travel Advisories</h2>
          </div>
          {loading ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Loading advisories…</CardContent></Card>
          ) : events.length === 0 ? (
            <Alert>
              <Shield className="h-4 w-4" />
              <AlertTitle>All clear</AlertTitle>
              <AlertDescription>
                No active force-majeure events declared. Travel and bookings are operating normally worldwide.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="grid gap-4">
              {events.map((e) => (
                <Card key={e.id} className="border-l-4 border-l-destructive">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <CardTitle className="text-xl">{e.title}</CardTitle>
                          <Badge variant="destructive">{EVENT_TYPE_LABELS[e.event_type] || e.event_type}</Badge>
                        </div>
                        <CardDescription>
                          {e.affected_country}
                          {e.affected_region ? ` · ${e.affected_region}` : ''}
                          {e.affected_cities?.length ? ` · ${e.affected_cities.join(', ')}` : ''}
                        </CardDescription>
                      </div>
                      <div className="text-right text-sm text-muted-foreground">
                        <div>{format(new Date(e.starts_at), 'MMM d, yyyy')}</div>
                        <div>→ {format(new Date(e.ends_at), 'MMM d, yyyy')}</div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {e.description && <p className="text-sm">{e.description}</p>}
                    <div className="rounded-lg bg-muted p-3 text-sm">
                      <div className="font-semibold mb-1">What this means for your booking</div>
                      <ul className="space-y-1 text-muted-foreground">
                        <li>• <span className="text-foreground font-medium">Guests:</span> Affected bookings are eligible for a full refund or free rebooking, regardless of the host's cancellation policy.</li>
                        <li>• <span className="text-foreground font-medium">Hosts:</span> Hostiva compensates {e.host_compensation_pct}% of the lost payout from the platform-funded protection pool — you are not penalised.</li>
                      </ul>
                    </div>
                    {e.source_reference && (
                      <p className="text-xs text-muted-foreground">Source: {e.source_reference}</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Pillars */}
        <section className="mb-12 grid md:grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <FileCheck className="w-6 h-6 text-primary mb-2" />
              <CardTitle className="text-base">Verified Identities</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Guests and hosts complete ID verification before transacting. Sanctions screening runs on every account.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Lock className="w-6 h-6 text-primary mb-2" />
              <CardTitle className="text-base">Secure Payments</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              All money flows through Hostiva. Hosts only get paid after guest check-in is confirmed — no off-platform payments, ever.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Heart className="w-6 h-6 text-primary mb-2" />
              <CardTitle className="text-base">24/7 Support</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Real humans are on call to mediate disputes, rebook stays, and process emergency refunds whenever you need help.
            </CardContent>
          </Card>
        </section>

        {/* Plain-language rules */}
        <section className="mb-12">
          <div className="flex items-center gap-2 mb-4">
            <MessageCircleWarning className="w-5 h-5 text-primary" />
            <h2 className="text-2xl font-display font-bold">Community Rules</h2>
          </div>
          <Accordion type="single" collapsible className="bg-card border rounded-lg px-4">
            <AccordionItem value="circumvention">
              <AccordionTrigger>Keep all communication and payments on Hostiva</AccordionTrigger>
              <AccordionContent className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Sharing phone numbers, emails, WhatsApp handles, social profiles, or external payment links before a booking is confirmed isn't allowed. This protects you from scams and ensures Hostiva's Guarantee covers your stay.
                </p>
                <p className="text-foreground font-medium">Three-strike enforcement:</p>
                <ul className="space-y-1 ml-4">
                  <li>1. <span className="text-foreground">First offence</span> — content blocked, written warning.</li>
                  <li>2. <span className="text-foreground">Second offence</span> — messaging temporarily restricted.</li>
                  <li>3. <span className="text-foreground">Third offence</span> — account suspended pending review.</li>
                </ul>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="sanctions">
              <AccordionTrigger>Sanctions & legal compliance</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground space-y-2">
                <p>
                  Every new account is screened against international sanctions lists (OFAC, UN, EU, UK). Accounts that match are frozen and reviewed by our compliance team before any booking can proceed.
                </p>
                <p>
                  Hostiva cannot facilitate stays in jurisdictions where short-term rentals are illegal. Listings violating local law are removed.
                </p>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="fraud">
              <AccordionTrigger>How we detect fraud</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground space-y-2">
                <p>
                  Every booking gets a real-time risk score based on account age, payment history, booking velocity, geo-signals, and behavioural patterns. High-risk bookings require ID re-verification or are held for human review before funds are released to the host.
                </p>
                <p>
                  If a chargeback happens after check-in, Hostiva absorbs the loss — your payout is never clawed back.
                </p>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="reviews">
              <AccordionTrigger>Honest, blind reviews</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground">
                Guests and hosts review each other after every stay. Reviews stay hidden until both sides submit (or 14 days pass), so feedback is always honest and never retaliatory.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="privacy">
              <AccordionTrigger>Your data, your control</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground">
                Personal contact details are only shared after a booking is confirmed. You can delete your account and request a full data export at any time from Settings.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>

        {/* Report section */}
        <section>
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="py-8 text-center">
              <Users className="w-8 h-8 text-primary mx-auto mb-3" />
              <h3 className="text-xl font-display font-bold mb-2">See something concerning?</h3>
              <p className="text-muted-foreground mb-4 max-w-xl mx-auto">
                Report unsafe listings, suspicious messages, or fraud attempts directly from the listing or message thread, or contact our trust & safety team.
              </p>
              <a href="/info/contact" className="inline-flex items-center gap-2 px-6 py-2 rounded-full bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors">
                <Globe className="w-4 h-4" /> Contact Trust & Safety
              </a>
            </CardContent>
          </Card>
        </section>
      </div>
    </Layout>
  );
}