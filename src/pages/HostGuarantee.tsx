import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';
import {
  Shield, ShieldAlert, Home, Users, CheckCircle, FileText,
  AlertTriangle, ArrowRight, HelpCircle, Phone, Info as InfoIcon,
} from 'lucide-react';

const recommendedCoverage = [
  { title: 'Short-term rental insurance', desc: 'A dedicated policy designed for hosting paying guests — standard homeowner policies often exclude this.' },
  { title: 'Property damage coverage', desc: 'Protection for furniture, appliances, flooring, walls, and fixtures against accidental or intentional guest damage.' },
  { title: 'Liability insurance', desc: 'Coverage for third-party bodily injury or property damage that may occur during a guest stay.' },
  { title: 'Loss of income', desc: 'Reimbursement for lost booking revenue if your property becomes uninhabitable due to a covered event.' },
  { title: 'Contents & valuables', desc: 'Protection for personal belongings, electronics, art, and decorative items inside the property.' },
  { title: 'Natural disaster cover', desc: 'Protection against fire, flood, storm, and other events not covered by guest-related policies.' },
];

const bestPractices = [
  { step: 1, title: 'Carry your own insurance', desc: 'Maintain an active short-term rental or landlord insurance policy with adequate coverage limits.', icon: Shield },
  { step: 2, title: 'Document your property', desc: 'Keep dated photos of every room, valuables, and serial numbers of high-value items before each stay.', icon: FileText },
  { step: 3, title: 'Take a security deposit', desc: 'Set an appropriate damage deposit on your listing to cover minor incidents directly with the guest.', icon: ShieldAlert },
  { step: 4, title: 'Resolve issues directly', desc: 'Communicate with your guest first via Messages. If unresolved, file a claim with your insurer using your documentation.', icon: Phone },
];

const faqs = [
  {
    q: 'Does Hostiva provide damage insurance or a host guarantee?',
    a: 'No. Hostiva is a marketplace that connects guests and hosts. Each host operates independently and is responsible for insuring their own property. Hostiva does not provide damage protection, liability coverage, or any form of insurance guarantee.',
  },
  {
    q: 'Why do I need my own insurance?',
    a: 'Standard homeowner or renter policies often exclude commercial activity such as short-term rentals. We strongly recommend hosts purchase a dedicated short-term rental policy that covers property damage, liability, and loss of income.',
  },
  {
    q: 'What does Hostiva do if a guest damages my property?',
    a: 'Hostiva facilitates communication between you and the guest through the Messages and Resolution Center tools. We can suspend abusive accounts and provide booking records, but we do not pay claims or reimburse damages.',
  },
  {
    q: 'Can I take a security deposit?',
    a: 'Yes. You can set a damage deposit on your listing. Deposits are held by the platform and released after checkout if no damage is reported within the claim window.',
  },
  {
    q: 'Where can I find short-term rental insurance?',
    a: 'Search for providers in your country that specialize in short-term rental, vacation rental, or "Airbnb-style" host insurance. Compare quotes carefully and confirm that paying guests are explicitly covered.',
  },
];

export default function HostGuarantee() {
  const navigate = useNavigate();

  return (
    <Layout>
      {/* Hero */}
      <section className="bg-gradient-to-b from-amber-50 to-background py-20">
        <div className="container mx-auto px-4 text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-amber-100 flex items-center justify-center">
            <ShieldAlert className="w-10 h-10 text-amber-600" />
          </div>
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
            Host <span className="text-amber-600">Insurance Guidance</span>
          </h1>
          <p className="text-muted-foreground text-lg md:text-xl max-w-2xl mx-auto mb-8 leading-relaxed">
            Hostiva is a marketplace — every host operates independently. We do not provide damage protection or insurance. Hosts are strongly advised to insure their own property.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Button size="lg" className="rounded-full px-8" onClick={() => navigate('/become-host')}>
              Start hosting <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        </div>
      </section>

      {/* Important notice */}
      <section className="py-10">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto border-2 border-amber-300 bg-amber-50 rounded-2xl p-6 md:p-8 flex gap-4">
            <AlertTriangle className="w-7 h-7 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-base md:text-lg mb-2">No Hostiva damage guarantee</p>
              <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                Hostiva does <strong>not</strong> offer a $1M Host Guarantee or any form of damage or liability insurance. Each host is fully responsible for protecting their own property. Please obtain appropriate short-term rental insurance before accepting bookings.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Recommended coverage */}
      <section className="py-16 bg-secondary/30">
        <div className="container mx-auto px-4">
          <div className="text-center mb-14">
            <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold px-3 py-1 rounded-full mb-4 tracking-wider uppercase">
              Recommended Coverage
            </span>
            <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">What your policy should include</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              When shopping for short-term rental insurance, look for these key protections.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {recommendedCoverage.map((item, i) => (
              <div key={i} className="flex items-start gap-4 bg-background rounded-xl p-5 border">
                <CheckCircle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-sm mb-1">{item.title}</p>
                  <p className="text-muted-foreground text-sm">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Best practices */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-14">
            <span className="inline-block bg-primary/10 text-primary text-xs font-bold px-3 py-1 rounded-full mb-4 tracking-wider uppercase">
              Best Practices
            </span>
            <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">Protect yourself as a host</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Simple steps every independent host should take before welcoming guests.
            </p>
          </div>

          <div className="max-w-4xl mx-auto">
            <div className="grid md:grid-cols-4 gap-6 relative">
              <div className="hidden md:block absolute top-14 left-[12.5%] right-[12.5%] h-0.5 bg-gradient-to-r from-amber-400 via-amber-300 to-amber-200" />

              {bestPractices.map((item) => (
                <div key={item.step} className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-amber-600 flex items-center justify-center mb-4 relative z-10 shadow-md">
                    <item.icon className="w-6 h-6 text-white" />
                  </div>
                  <span className="text-xs font-bold text-amber-600 mb-1">STEP {item.step}</span>
                  <h3 className="font-bold text-sm mb-2">{item.title}</h3>
                  <p className="text-muted-foreground text-xs leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* What Hostiva does provide */}
      <section className="py-20 bg-secondary/30">
        <div className="container mx-auto px-4">
          <div className="text-center mb-14">
            <span className="inline-block bg-blue-100 text-blue-700 text-xs font-bold px-3 py-1 rounded-full mb-4 tracking-wider uppercase">
              Platform Tools
            </span>
            <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">What Hostiva does provide</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              While we don't insure your property, our platform gives you tools to reduce risk and resolve issues.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            {[
              { icon: Users, title: 'Guest Verification', desc: 'Guests verify identity with email, phone, and government-issued ID.', color: 'bg-indigo-50 text-indigo-600' },
              { icon: Shield, title: 'Secure Payments', desc: 'Payments processed via Stripe with PCI-DSS Level 1 compliance.', color: 'bg-blue-50 text-blue-600' },
              { icon: Phone, title: 'Resolution Center', desc: 'Built-in tools to communicate with guests and document issues.', color: 'bg-violet-50 text-violet-600' },
              { icon: InfoIcon, title: 'Booking Records', desc: 'Complete reservation, message, and payment history available for your insurer.', color: 'bg-amber-50 text-amber-600' },
            ].map((item, i) => (
              <Card key={i} className="border shadow-sm text-center">
                <CardContent className="p-6">
                  <div className={`w-14 h-14 mx-auto mb-4 rounded-2xl ${item.color} flex items-center justify-center`}>
                    <item.icon className="w-7 h-7" />
                  </div>
                  <h3 className="font-bold mb-2">{item.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-14">
            <span className="inline-block bg-muted text-muted-foreground text-xs font-bold px-3 py-1 rounded-full mb-4 tracking-wider uppercase">
              FAQ
            </span>
            <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">Frequently asked questions</h2>
          </div>

          <div className="max-w-3xl mx-auto space-y-4">
            {faqs.map((faq, i) => (
              <div key={i} className="border rounded-xl p-6">
                <div className="flex items-start gap-3">
                  <HelpCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold mb-2">{faq.q}</p>
                    <p className="text-muted-foreground text-sm leading-relaxed">{faq.a}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto bg-amber-50 rounded-3xl py-16 px-8 text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-amber-600 flex items-center justify-center shadow-lg">
              <Home className="w-8 h-8 text-white" />
            </div>
            <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">
              Host responsibly
            </h2>
            <p className="text-muted-foreground text-lg mb-8 max-w-md mx-auto">
              Insure your property, document your space, and use our platform tools to manage every booking with confidence.
            </p>
            <Button size="lg" className="rounded-full px-10" onClick={() => navigate('/become-host')}>
              Become a host <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        </div>
      </section>
    </Layout>
  );
}
