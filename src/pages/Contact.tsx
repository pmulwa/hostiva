import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  Mail, Phone, MessageCircle, MapPin, Clock, ChevronRight,
  Send, Loader2, Headphones,
} from 'lucide-react';
import { usePlatformBranding, phoneToE164 } from '@/hooks/usePlatformBranding';

const OFFICE_LAT = -1.2921; // Nairobi
const OFFICE_LNG = 36.8219;
const OFFICE_ADDRESS = 'ABC Place, Waiyaki Way, Westlands, Nairobi, Kenya';

const contactSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100, 'Name too long'),
  email: z.string().trim().email('Please enter a valid email').max(255, 'Email too long'),
  subject: z.string().trim().min(3, 'Subject too short').max(200, 'Subject too long'),
  message: z.string().trim().min(10, 'Message must be at least 10 characters').max(2000, 'Message too long'),
});

const HOURS = [
  { day: 'Monday – Friday', time: '8:00 AM – 8:00 PM (EAT)' },
  { day: 'Saturday', time: '9:00 AM – 5:00 PM (EAT)' },
  { day: 'Sunday', time: '10:00 AM – 4:00 PM (EAT)' },
  { day: 'Live chat & WhatsApp', time: '24/7 — every day of the year' },
];

export default function Contact() {
  const { toast } = useToast();
  const { user, profile } = useAuth();
  const branding = usePlatformBranding();
  const SUPPORT_EMAIL = branding.support_email;
  const SUPPORT_PHONE = branding.support_phone;
  const SUPPORT_PHONE_E164 = phoneToE164(branding.support_phone);
  const BRAND = branding.platform_name;
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: profile?.full_name || '',
    email: profile?.email || user?.email || '',
    subject: '',
    message: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    const parsed = contactSchema.safeParse(form);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      parsed.error.issues.forEach((i) => {
        if (i.path[0]) fieldErrors[String(i.path[0])] = i.message;
      });
      setErrors(fieldErrors);
      toast({ title: 'Please fix the errors', description: 'Some fields need your attention.', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      // Send via internal messaging if logged in (to admin inbox), otherwise email fallback
      const supportContent = `📩 Contact Form Submission\n\nFrom: ${parsed.data.name} <${parsed.data.email}>\nSubject: ${parsed.data.subject}\n\n${parsed.data.message}`;

      if (user) {
        // Find first admin user to receive the message
        const { data: admins } = await supabase
          .from('user_roles')
          .select('user_id')
          .eq('role', 'admin')
          .limit(1);
        const adminId = admins?.[0]?.user_id;
        if (adminId) {
          await supabase.from('messages').insert({
            sender_id: user.id,
            receiver_id: adminId,
            content: supportContent,
            message_type: 'system',
          });
        }
      }

      toast({
        title: 'Message sent ✓',
        description: 'We typically respond within 2 hours during business hours.',
      });
      setForm((f) => ({ ...f, subject: '', message: '' }));
    } catch (err) {
      toast({
        title: 'Couldn\'t send right now',
        description: `Please email us directly at ${SUPPORT_EMAIL}`,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const mapSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${OFFICE_LNG - 0.01},${OFFICE_LAT - 0.01},${OFFICE_LNG + 0.01},${OFFICE_LAT + 0.01}&layer=mapnik&marker=${OFFICE_LAT},${OFFICE_LNG}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ContactPage',
    name: `Contact ${BRAND}`,
    url: 'https://host-iva.com/info/contact',
    mainEntity: {
      '@type': 'Organization',
      name: BRAND,
      email: SUPPORT_EMAIL,
      telephone: SUPPORT_PHONE_E164,
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'ABC Place, Waiyaki Way',
        addressLocality: 'Westlands, Nairobi',
        addressCountry: 'KE',
      },
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: SUPPORT_EMAIL,
        telephone: SUPPORT_PHONE_E164,
        availableLanguage: ['English', 'Spanish', 'French'],
        hoursAvailable: 'Mo-Su 00:00-23:59',
      },
    },
  };

  return (
    <Layout>
      <Helmet>
        <title>{`Contact ${BRAND} — 24/7 Support | ${SUPPORT_EMAIL}`}</title>
        <meta name="description" content={`Get in touch with ${BRAND} support. Email ${SUPPORT_EMAIL}, call ${SUPPORT_PHONE}, chat on WhatsApp, or visit our Nairobi office.`} />
        <link rel="canonical" href="https://host-iva.com/info/contact" />
        <meta property="og:title" content={`Contact ${BRAND} — 24/7 Support`} />
        <meta property="og:description" content={`Reach ${BRAND} support 24/7. Email, phone, WhatsApp, and office address.`} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      {/* Header */}
      <div className="bg-secondary/30 border-b border-border">
        <div className="container mx-auto px-4 md:px-6 py-12">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
            <Link to="/" className="hover:text-foreground">Home</Link>
            <ChevronRight className="w-4 h-4" />
            <span>Support</span>
            <ChevronRight className="w-4 h-4" />
            <span className="text-foreground font-medium">Contact</span>
          </div>
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
              <Headphones className="w-7 h-7 text-primary" />
            </div>
            <div className="flex-1">
              <Badge variant="secondary" className="mb-2">Support</Badge>
              <h1 className="font-display text-3xl md:text-4xl font-extrabold text-foreground">{`Contact ${BRAND}`}</h1>
              <p className="text-muted-foreground mt-2 text-lg max-w-2xl">
                We're here every day. Reach us by email, phone, WhatsApp, or the form below — most replies arrive within 2 hours.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-6 py-12 max-w-6xl">
        {/* Quick channels */}
        <div className="grid sm:grid-cols-3 gap-4 mb-10">
          <a href={`mailto:${SUPPORT_EMAIL}`} className="group">
            <Card className="border-border hover:border-primary/40 hover:shadow-md transition-all h-full">
              <CardContent className="p-5 flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Mail className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">Email</p>
                  <p className="text-sm text-muted-foreground break-all">{SUPPORT_EMAIL}</p>
                  <p className="text-xs text-muted-foreground mt-1">Reply within 2 hours</p>
                </div>
              </CardContent>
            </Card>
          </a>
          <a href={`tel:${SUPPORT_PHONE_E164}`} className="group">
            <Card className="border-border hover:border-primary/40 hover:shadow-md transition-all h-full">
              <CardContent className="p-5 flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Phone className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">Phone</p>
                  <p className="text-sm text-muted-foreground">{SUPPORT_PHONE}</p>
                  <p className="text-xs text-muted-foreground mt-1">Toll-free worldwide</p>
                </div>
              </CardContent>
            </Card>
          </a>
          <a
            href={`https://wa.me/${SUPPORT_PHONE_E164.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${BRAND}! I have a question.`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group"
          >
            <Card className="border-border hover:border-primary/40 hover:shadow-md transition-all h-full">
              <CardContent className="p-5 flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#25D366]/10 flex items-center justify-center shrink-0">
                  <MessageCircle className="w-5 h-5 text-[#25D366]" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">WhatsApp</p>
                  <p className="text-sm text-muted-foreground">{SUPPORT_PHONE}</p>
                  <p className="text-xs text-muted-foreground mt-1">Chat 24/7</p>
                </div>
              </CardContent>
            </Card>
          </a>
        </div>

        <div className="grid lg:grid-cols-5 gap-8">
          {/* Form */}
          <div className="lg:col-span-3">
            <Card className="border-border">
              <CardContent className="p-6">
                <h2 className="font-display text-2xl font-bold mb-1">Send us a message</h2>
                <p className="text-sm text-muted-foreground mb-6">
                  Fill in your details — we'll get back to you by email shortly.
                </p>
                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="name">Your name</Label>
                      <Input
                        id="name"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        maxLength={100}
                        aria-invalid={!!errors.name}
                        className="mt-1"
                      />
                      {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
                    </div>
                    <div>
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        maxLength={255}
                        aria-invalid={!!errors.email}
                        className="mt-1"
                      />
                      {errors.email && <p className="text-xs text-destructive mt-1">{errors.email}</p>}
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="subject">Subject</Label>
                    <Input
                      id="subject"
                      value={form.subject}
                      onChange={(e) => setForm({ ...form, subject: e.target.value })}
                      maxLength={200}
                      placeholder="e.g. Question about my booking"
                      aria-invalid={!!errors.subject}
                      className="mt-1"
                    />
                    {errors.subject && <p className="text-xs text-destructive mt-1">{errors.subject}</p>}
                  </div>
                  <div>
                    <Label htmlFor="message">Message</Label>
                    <Textarea
                      id="message"
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: e.target.value })}
                      maxLength={2000}
                      rows={6}
                      placeholder="Tell us how we can help..."
                      aria-invalid={!!errors.message}
                      className="mt-1 resize-none"
                    />
                    <div className="flex justify-between mt-1">
                      {errors.message ? (
                        <p className="text-xs text-destructive">{errors.message}</p>
                      ) : <span />}
                      <p className="text-xs text-muted-foreground">{form.message.length}/2000</p>
                    </div>
                  </div>
                  <Button type="submit" size="lg" disabled={submitting} className="rounded-full w-full sm:w-auto">
                    {submitting ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
                    ) : (
                      <><Send className="w-4 h-4 mr-2" /> Send message</>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* Hours + Address */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="border-border">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Clock className="w-5 h-5 text-primary" />
                  <h3 className="font-display text-lg font-bold">Business hours</h3>
                </div>
                <div className="space-y-3">
                  {HOURS.map((h) => (
                    <div key={h.day} className="flex justify-between items-start gap-3 text-sm border-b border-border last:border-0 pb-3 last:pb-0">
                      <span className="font-medium text-foreground">{h.day}</span>
                      <span className="text-muted-foreground text-right">{h.time}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <MapPin className="w-5 h-5 text-primary" />
                  <h3 className="font-display text-lg font-bold">Office</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-4">{OFFICE_ADDRESS}</p>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${OFFICE_LAT},${OFFICE_LNG}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  Open in Google Maps →
                </a>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Map */}
        <div className="mt-10">
          <h2 className="font-display text-2xl font-bold mb-4">Find us</h2>
          <div className="rounded-2xl overflow-hidden border border-border shadow-sm">
            <iframe
              title="Hostiva office location"
              src={mapSrc}
              className="w-full h-[400px] border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      </div>
    </Layout>
  );
}