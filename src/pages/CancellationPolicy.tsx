import { Helmet } from 'react-helmet-async';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Link } from 'react-router-dom';
import {
  ShieldCheck, Clock, AlertTriangle, Heart, Ban, Calendar,
  DollarSign, ArrowRight, CheckCircle2, XCircle, Info,
} from 'lucide-react';
import { useCancellationPolicy } from '@/hooks/useCancellationPolicy';

const SPECIAL_CASES = [
  { title: 'Booking modification', desc: 'Free if new dates are equal/higher value and 7+ days away. Otherwise $25 fee + rate difference.' },
  { title: 'Force majeure', desc: 'Disasters, pandemics, government lockdowns. Guest 100% refund, host 25% goodwill from Hostiva Trust Fund.' },
  { title: 'Property destroyed', desc: 'Fire/flood/structural damage. Guest 100% refund + $100 credit, no host penalty.' },
  { title: 'Double-booking', desc: 'Calendar sync error. Guest 100% refund + $150 credit, no host penalty (Hostiva absorbs).' },
  { title: 'Guest death', desc: 'Death certificate required. 100% refund of unused nights, all Hostiva fees waived as goodwill.' },
  { title: 'Goodwill request', desc: 'Host approves 100% refund of accommodation + cleaning + taxes. Guest service fee is NEVER refunded.' },
];

export default function CancellationPolicy() {
  const { policy } = useCancellationPolicy();

  const TIERS = [
    { id: 1, name: 'Grace Period', when: 'Within 24h of booking AND 7+ days before check-in', guest: '100%', host: '0%', cleaning: 'Refunded' },
    { id: 2, name: 'Early Cancellation', when: '7+ days before check-in', guest: '100%', host: '0%', cleaning: 'Refunded' },
    { id: 3, name: 'Standard Cancellation', when: '3–7 days before check-in', guest: `${policy.tier3_cash_refund_pct}% cash refund`, host: `${policy.tier3_host_comp_pct}%`, cleaning: 'Refunded' },
    { id: 4, name: 'Late Cancellation', when: '24–72 hours before check-in', guest: `${policy.tier4_cash_refund_pct}% cash refund`, host: `${policy.tier4_host_comp_pct}%`, cleaning: 'Refunded' },
    { id: 5, name: 'Same-Day Cancellation', when: 'Less than 24h before check-in', guest: 'All nights minus 1', host: '1 night + service fee', cleaning: 'Paid if cleaned' },
    { id: 6, name: 'No-Show', when: 'Past check-in time, no guest contact', guest: '0%', host: '1 night + service fee', cleaning: 'Forfeited' },
    { id: 7, name: 'Mid-Stay Cancellation', when: 'After check-in', guest: 'Remaining nights minus 1', host: 'Stayed nights + 1 + service', cleaning: 'Forfeited' },
    { id: 8, name: 'Property Issue (Host Fault)', when: 'After check-in, host fault', guest: `${policy.tier8_unused_refund_pct}% unused + ${policy.tier8_stayed_refund_pct}% stayed`, host: `${100 - policy.tier8_stayed_refund_pct}% stayed only`, cleaning: 'Refunded' },
    { id: 9, name: 'Emergency Mid-Stay', when: 'After check-in, documented', guest: `${policy.tier9_unused_refund_pct}% unused + ${policy.tier9_stayed_refund_pct}% stayed`, host: `${100 - policy.tier9_stayed_refund_pct}% stayed + service`, cleaning: 'Refunded' },
    { id: 11, name: 'Guest Eviction', when: 'After check-in, guest fault', guest: '0%', host: '100% + damages claim', cleaning: 'Paid' },
    { id: 12, name: 'Host Cancels (30+ days)', when: 'Host-initiated', guest: `100% + $${policy.host_cancel_credit_30plus} credit`, host: policy.host_cancel_fine_30plus > 0 ? `0 + $${policy.host_cancel_fine_30plus} fine` : '0 + warning', cleaning: 'Refunded' },
    { id: 13, name: 'Host Cancels (7–30 days)', when: 'Host-initiated', guest: `100% + $${policy.host_cancel_credit_7_30} credit`, host: `0 + $${policy.host_cancel_fine_7_30} fine`, cleaning: 'Refunded' },
    { id: 14, name: 'Host Cancels (<7 days)', when: 'Host-initiated', guest: `100% + $${policy.host_cancel_credit_under_7} credit`, host: `0 + $${policy.host_cancel_fine_under_7} fine`, cleaning: 'Refunded' },
    { id: 15, name: 'Host Cancels (<24h)', when: 'Host-initiated', guest: `100% + $${policy.host_cancel_credit_under_24h} credit`, host: `0 + $${policy.host_cancel_fine_under_24h} fine`, cleaning: 'Refunded' },
    { id: 16, name: 'Host Cancels Post-Check-in', when: 'Host-initiated, after check-in', guest: '100% + $500 + relocation', host: 'Account banned', cleaning: 'Refunded' },
  ];

  return (
    <Layout>
      <Helmet>
        <title>Cancellation Policy — 16 Tiers Explained | Hostiva</title>
        <meta name="description" content="Hostiva's complete cancellation engine: 16 tiers covering pre-check-in, mid-stay, no-show, host-initiated, force majeure, and goodwill scenarios. Transparent math every time." />
        <link rel="canonical" href="/cancellation-policy" />
        <meta property="og:title" content="Hostiva Cancellation Policy" />
        <meta property="og:description" content="A transparent 16-tier cancellation engine that protects both guests and hosts." />
        <script type="application/ld+json">{JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: 'Hostiva Cancellation Policy',
          description: 'A transparent 16-tier cancellation engine for short-term rentals.',
          publisher: { '@type': 'Organization', name: 'Hostiva' },
        })}</script>
      </Helmet>

      <div className="bg-gradient-to-b from-primary/5 via-background to-background border-b border-border">
        <div className="container mx-auto px-4 py-16">
          <Badge variant="outline" className="mb-4">Trust & Safety</Badge>
          <h1 className="text-4xl md:text-5xl font-display font-bold mb-4 tracking-tight">Cancellation Policy</h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Sixteen tiers, every one of them transparent. You'll always see the math before you confirm —
            no hidden fees, no last-minute surprises.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12 space-y-12 max-w-5xl">
        {/* Core formula */}
        <section>
          <h2 className="text-2xl font-display font-bold mb-4 flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-primary" /> The math behind every refund
          </h2>
          <Card>
            <CardContent className="p-6 space-y-3">
              <p className="text-muted-foreground">Every cancellation calculation uses these building blocks:</p>
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                <div><span className="font-mono font-semibold">NR</span> · Nightly Rate</div>
                <div><span className="font-mono font-semibold">TN</span> · Total Nights booked</div>
                <div><span className="font-mono font-semibold">NS</span> · Nights actually Stayed</div>
                <div><span className="font-mono font-semibold">CF</span> · Cleaning Fee</div>
                <div><span className="font-mono font-semibold">SF</span> · Service Fee (Hostiva platform)</div>
                <div><span className="font-mono font-semibold">PF</span> · Processing Fee (Paystack, never refundable)</div>
                <div><span className="font-mono font-semibold">TX</span> · Taxes (tourism levy, VAT)</div>
                <div><span className="font-mono font-semibold">SD</span> · Security Deposit</div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* The 16 tiers table */}
        <section>
          <h2 className="text-2xl font-display font-bold mb-4 flex items-center gap-2">
            <Ban className="w-6 h-6 text-primary" /> The 16 tiers at a glance
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-semibold">Tier</th>
                  <th className="text-left p-3 font-semibold">When it applies</th>
                  <th className="text-left p-3 font-semibold">Guest receives</th>
                  <th className="text-left p-3 font-semibold">Host receives</th>
                  <th className="text-left p-3 font-semibold">Cleaning fee</th>
                </tr>
              </thead>
              <tbody>
                {TIERS.map(t => (
                  <tr key={t.id} className="border-t border-border hover:bg-muted/30">
                    <td className="p-3 font-medium">
                      <Badge variant="outline" className="font-mono text-xs">T{t.id}</Badge>
                      <span className="ml-2">{t.name}</span>
                    </td>
                    <td className="p-3 text-muted-foreground">{t.when}</td>
                    <td className="p-3">{t.guest}</td>
                    <td className="p-3">{t.host}</td>
                    <td className="p-3 text-muted-foreground">{t.cleaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Same-day rule (Tier 5) */}
        <section className="grid md:grid-cols-2 gap-6">
          <Card className="border-primary/30">
            <CardContent className="p-6">
              <Badge className="mb-3">Tier 5 · Same-Day</Badge>
              <h3 className="text-xl font-display font-bold mb-3">Cancelled within 24h of check-in</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /> Guest receives all nights minus 1, plus prorated taxes.</li>
                <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /> Cleaning fee refunded if property hasn't been cleaned yet.</li>
                <li className="flex gap-2"><DollarSign className="w-4 h-4 text-foreground mt-0.5 shrink-0" /> Host gets 1 compensation night + full service fee.</li>
                <li className="flex gap-2"><DollarSign className="w-4 h-4 text-foreground mt-0.5 shrink-0" /> Host gets cleaning fee if it was already performed.</li>
              </ul>
            </CardContent>
          </Card>
          <Card className="border-primary/30">
            <CardContent className="p-6">
              <Badge className="mb-3">Tier 7 · Mid-Stay</Badge>
              <h3 className="text-xl font-display font-bold mb-3">Leaving early, mid-stay</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2"><DollarSign className="w-4 h-4 text-foreground mt-0.5 shrink-0" /> Host receives nights stayed + 1 buffer night + service fee + cleaning fee.</li>
                <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /> Guest refunded the remaining unused nights minus 1.</li>
                <li className="flex gap-2"><XCircle className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" /> Cleaning fee always forfeited (property was used).</li>
                <li className="flex gap-2"><XCircle className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" /> Service fee is non-refundable (applies to every tier except T1/T2).</li>
              </ul>
            </CardContent>
          </Card>
        </section>

        {/* Goodwill option */}
        <section>
          <Card className="bg-primary/5 border-primary/30">
            <CardContent className="p-6">
              <div className="flex items-start gap-3">
                <Heart className="w-6 h-6 text-primary mt-1" />
                <div>
                  <h3 className="text-xl font-display font-bold mb-2">100% refund — with host approval</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    For any tier, you can ask the host to approve a goodwill cancellation. If accepted, accommodation,
                    cleaning, and taxes are fully refunded. <span className="font-semibold text-foreground">However,
                    the guest service fee is never refunded</span> — it covers Hostiva's platform costs that have already been incurred.
                  </p>
                  <p className="text-xs text-muted-foreground">Hosts have full discretion. There are no penalties either way.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Special cases */}
        <section>
          <h2 className="text-2xl font-display font-bold mb-4 flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-primary" /> Special cases
          </h2>
          <Accordion type="single" collapsible className="border border-border rounded-lg">
            {SPECIAL_CASES.map((c, i) => (
              <AccordionItem key={i} value={`item-${i}`} className="px-4">
                <AccordionTrigger className="text-left font-semibold">{c.title}</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">{c.desc}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        {/* Timeline */}
        <section>
          <h2 className="text-2xl font-display font-bold mb-4 flex items-center gap-2">
            <Clock className="w-6 h-6 text-primary" /> Refund processing timeline
          </h2>
          <Card>
            <CardContent className="p-6 space-y-3 text-sm">
              {[
                ['T+0 instant', 'Cancellation recorded, calendar released, breakdown shown.'],
                ['T+1 min', 'Email + SMS confirmation to both parties with itemized math.'],
                ['T+2 hours', 'Refund initiated via Paystack (if no dispute).'],
                ['T+1–5 business days', 'Cash refund lands in your account.'],
                ['T+instant', 'Rebooking credits issued immediately to your wallet.'],
                ['T+14 days', 'Host payout for their portion released (standard fraud-protection hold).'],
              ].map(([when, what]) => (
                <div key={when} className="flex gap-3">
                  <Badge variant="outline" className="font-mono text-xs shrink-0 self-start">{when}</Badge>
                  <span className="text-muted-foreground">{what}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        {/* CTAs */}
        <section className="text-center space-y-4 py-8">
          <p className="text-sm text-muted-foreground">Have questions? We're here to help.</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild variant="outline">
              <Link to="/info/help-center">Help Center</Link>
            </Button>
            <Button asChild>
              <Link to="/bookings">View my bookings <ArrowRight className="w-4 h-4 ml-1" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </Layout>
  );
}