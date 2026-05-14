import { useParams, Navigate, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import {
  HelpCircle, ShieldCheck, Accessibility as AccessibilityIcon, Ban, Home as HomeIcon,
  BookOpen, MessageSquare, Heart, Newspaper, Sparkles, Briefcase, TrendingUp,
  ChevronRight, Mail, Phone, ArrowRight, CheckCircle2, AlertCircle, Users,
  CreditCard, RotateCcw, UserCog, Star,
  DollarSign, Camera, PenLine, CalendarDays, MessageSquareText, Calculator,
} from 'lucide-react';

type InfoSection =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'callout'; tone: 'info' | 'warn' | 'success'; title: string; text: string }
  | { type: 'cards'; items: { title: string; desc: string; to?: string }[] }
  | { type: 'faq'; items: { q: string; a: string }[] };

interface InfoPageData {
  slug: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  category: string;
  sections: InfoSection[];
  cta?: { label: string; to: string };
}

const PAGES: Record<string, InfoPageData> = {
  // ---------------- SUPPORT ----------------
  'help-center': {
    slug: 'help-center',
    title: 'Help Center',
    subtitle: 'Answers to the questions guests and hosts ask most.',
    icon: HelpCircle,
    category: 'Support',
    sections: [
      { type: 'heading', text: 'Browse by topic' },
      {
        type: 'cards',
        items: [
          { title: 'Booking & payments', desc: 'Reservation status, payment methods, receipts, and confirmation emails.', to: '/info/booking-payments' },
          { title: 'Refunds & cancellations', desc: 'How refunds work, when they\'re issued, and how to request a free cancellation.', to: '/info/refunds-cancellations' },
          { title: 'Account & profile', desc: 'Update your email, password, verify your ID, and manage notification preferences.', to: '/info/account-profile' },
          { title: 'Hosting basics', desc: 'List a property, set pricing, manage your calendar, and accept your first booking.', to: '/info/hosting-basics' },
          { title: 'Trust & safety', desc: 'Verified profiles, secure messaging, and what to do if something goes wrong.', to: '/info/trust-safety' },
          { title: 'Reviews & ratings', desc: 'How the dual-blind review system works for both guests and hosts.', to: '/info/reviews-ratings' },
        ],
      },
      { type: 'heading', text: 'Frequently asked questions' },
      {
        type: 'faq',
        items: [
          { q: 'How do I cancel a booking?', a: 'Go to My Bookings, open the reservation, and select "Cancel". You\'ll see your refund amount based on the cancellation policy before confirming. You can also request a free cancellation from your host.' },
          { q: 'When am I charged for a booking?', a: 'Payment is collected in full at the time of booking through Paystack. The host receives their payout 24 hours after guest check-in.' },
          { q: 'How do I contact my host or guest?', a: 'Use the Messages tab. Conversations are tied to each booking and support real-time replies, scheduled messages, and quick templates.' },
          { q: 'What if my host cancels?', a: 'You receive a 100% refund automatically. The host is also charged a penalty (commission, tax, and service fee) and the dates are unblocked on the calendar.' },
          { q: 'How do I become a host?', a: 'Click "List your space" from any page. Once your first listing is approved by our team, you\'re automatically promoted to host and can switch between Travelling and Hosting modes from the header.' },
        ],
      },
      {
        type: 'callout',
        tone: 'info',
        title: 'Still need help?',
        text: 'Reach our support team 24/7 by sending a message from your dashboard. Most replies arrive within 2 hours.',
      },
    ],
    cta: { label: 'Open Messages', to: '/messages' },
  },

  'safety': {
    slug: 'safety',
    title: 'SafetyStay',
    subtitle: 'Our commitment to keeping every reservation safe — for guests and hosts alike.',
    icon: ShieldCheck,
    category: 'Support',
    sections: [
      { type: 'paragraph', text: 'SafetyStay is the set of standards, tools, and protections built into every Hostiva reservation. From the moment you book to the day you check out, we work to keep your stay secure, transparent, and well-supported.' },
      { type: 'heading', text: 'How we keep you safe' },
      {
        type: 'cards',
        items: [
          { title: 'Verified profiles', desc: 'Phone, email, and government ID verification badges help you book with confidence.' },
          { title: 'Secure payments', desc: 'All transactions are processed through Paystack — CBK authorised and PCI-DSS compliant. We never share your card details with hosts.' },
          { title: 'Encrypted messaging', desc: 'Every conversation between guests and hosts stays inside Hostiva. We never share contact details.' },
          { title: 'Independent host insurance', desc: 'Hostiva does not insure properties. Every host operates independently and is strongly advised to carry their own short-term rental insurance.' },
          { title: '24/7 support', desc: 'Our trust & safety team is available around the clock to handle urgent issues during a stay.' },
          { title: 'Risk screening', desc: 'Bookings are automatically screened for fraud signals before payment is captured.' },
        ],
      },
      { type: 'heading', text: 'In case something goes wrong' },
      {
        type: 'list',
        items: [
          'Document the issue with photos or videos as soon as possible.',
          'Contact your host or guest first via the Messages tab — most issues are resolved within hours.',
          'If you can\'t reach a resolution, open a Resolution Center request from your booking.',
          'For emergencies that affect health or safety, contact local emergency services first, then notify Hostiva.',
        ],
      },
      {
        type: 'callout',
        tone: 'warn',
        title: 'Report a safety concern',
        text: 'If you suspect a listing or user is unsafe, report it from the listing page or by messaging support. Reports are confidential.',
      },
    ],
    cta: { label: 'Read host insurance guidance', to: '/host-guarantee' },
  },

  'accessibility': {
    slug: 'accessibility',
    title: 'Accessibility',
    subtitle: 'Building a platform everyone can use, regardless of ability.',
    icon: AccessibilityIcon,
    category: 'Support',
    sections: [
      { type: 'paragraph', text: 'Hostiva is committed to providing an accessible experience for all users. We design and develop our website following the Web Content Accessibility Guidelines (WCAG) 2.1 Level AA standard.' },
      { type: 'heading', text: 'Built-in accessibility features' },
      {
        type: 'list',
        items: [
          'Full keyboard navigation across every page and dialog.',
          'High-contrast theme option in user Settings.',
          'Adjustable font size (small, medium, large, extra large).',
          'Reduced-motion mode for users sensitive to animation.',
          'Screen reader optimization with semantic HTML and ARIA labels.',
          'Alt text on all property photos and avatars.',
          'Resizable text up to 200% without breaking the layout.',
          '12 supported languages including right-to-left layouts for Arabic.',
        ],
      },
      { type: 'heading', text: 'Accessibility filters when searching' },
      { type: 'paragraph', text: 'Guests can filter listings by step-free entry, single-floor layouts, accessible bathrooms, and parking. Hosts can declare these features when listing a property.' },
      {
        type: 'callout',
        tone: 'info',
        title: 'Found a barrier?',
        text: 'We\'re always improving. Email support@hostly.co.ke with feedback or specific issues — we typically respond within 5 business days.',
      },
    ],
    cta: { label: 'Open accessibility settings', to: '/settings' },
  },

  'cancellation-options': {
    slug: 'cancellation-options',
    title: 'Cancellation Options',
    subtitle: 'Clear, fair policies for both guests and hosts.',
    icon: Ban,
    category: 'Support',
    sections: [
      { type: 'paragraph', text: 'Hostiva uses a 3-tier cancellation policy that balances guest flexibility with host protection. The refund you receive depends on how far in advance you cancel.' },
      { type: 'heading', text: 'Standard guest refund tiers' },
      {
        type: 'cards',
        items: [
          { title: '5 or more days before check-in', desc: '100% refund of accommodation — no host approval required. Only the platform service fee is retained.' },
          { title: '3 days before check-in', desc: '50% automatic refund. You may request a free cancellation from the host for a higher refund.' },
          { title: 'Within 24 hours of check-in', desc: '0% automatic refund. You may still request a free cancellation — only granted if the host approves.' },
        ],
      },
      { type: 'heading', text: 'Free cancellation request' },
      { type: 'paragraph', text: 'For the 3-day and 24-hour tiers you can request a free cancellation directly from the host. If approved, only the platform service fee is retained — the rest is fully refunded. Hosts receive a notification badge in their header and can approve or decline from Messages. The 5+ day tier never requires host approval.' },
      { type: 'heading', text: 'When the host cancels' },
      { type: 'paragraph', text: 'If a host cancels a confirmed booking, the guest receives a 100% refund automatically and the host is charged a penalty (commission, tax, and service fee) to discourage unreliable cancellations. The dates are also released back to the calendar so other guests can book.' },
      {
        type: 'callout',
        tone: 'success',
        title: 'Always shown before you confirm',
        text: 'You\'ll see your exact refund amount on the cancellation screen before anything is processed. Nothing happens until you click the final confirm button.',
      },
    ],
    cta: { label: 'View my bookings', to: '/bookings' },
  },

  // ---------------- HOSTING ----------------
  'list-your-space': {
    slug: 'list-your-space',
    title: 'List your space',
    subtitle: 'Turn extra space into income — in less than 30 minutes.',
    icon: HomeIcon,
    category: 'Hosting',
    sections: [
      { type: 'paragraph', text: 'Whether you\'re renting out a spare room, a vacation cabin, or a luxury villa, Hostiva gives you the tools to manage bookings, payments, calendars, and guests from one dashboard.' },
      { type: 'heading', text: 'How it works' },
      {
        type: 'cards',
        items: [
          { title: '1. Describe your place', desc: 'Add photos, amenities, house rules, and pricing through our step-by-step wizard. You can even import an existing listing from another platform.' },
          { title: '2. Set your rules', desc: 'Choose instant booking or request approval, set minimum and maximum stays, weekend pricing, and check-in windows.' },
          { title: '3. Get approved', desc: 'Our team reviews new listings within 24-48 hours to ensure quality and accuracy.' },
          { title: '4. Welcome your first guest', desc: 'Once live, manage your calendar, sync with Airbnb or Booking.com via iCal, and chat with guests in real time.' },
        ],
      },
      { type: 'heading', text: 'What you earn' },
      { type: 'paragraph', text: 'You set your nightly rate and cleaning fee. Hostiva takes a 3% host commission plus a service fee that you can pass to the guest, absorb yourself, or split 50/50. Payouts are released 24 hours after guest check-in.' },
      {
        type: 'callout',
        tone: 'success',
        title: 'No upfront cost',
        text: 'Listing is free. You only pay when you earn — there are no monthly fees, no listing fees, no hidden charges.',
      },
    ],
    cta: { label: 'Start listing', to: '/become-host' },
  },

  'host-resources': {
    slug: 'host-resources',
    title: 'Host Resources',
    subtitle: 'Guides, tools, and best practices from top-performing hosts.',
    icon: BookOpen,
    category: 'Hosting',
    sections: [
      { type: 'heading', text: 'Essential guides' },
      {
        type: 'cards',
        items: [
          { title: 'Pricing your listing', desc: 'How to use seasonal pricing, weekend rates (Fri-Sun), and last-minute discounts to maximize occupancy.', to: '/info/host-pricing' },
          { title: 'Photography that converts', desc: 'A 12-photo checklist, lighting tips, and the wide-angle shots guests scroll for.', to: '/info/host-photography' },
          { title: 'Writing a winning description', desc: 'The opening line, the amenities list, and the neighborhood paragraph that earn instant bookings.', to: '/info/host-description' },
          { title: 'Calendar & iCal sync', desc: 'Connect Airbnb, Booking.com, and Vrbo calendars to prevent double bookings. Auto-sync runs every 2 hours.', to: '/info/host-calendar-sync' },
          { title: 'Handling reviews', desc: 'How the blind dual-review system works and how to respond to feedback professionally.', to: '/info/host-reviews' },
          { title: 'Tax & accounting', desc: 'Use the Financial Books module to track every payout, expense, and deductible — exportable to CSV.', to: '/info/host-tax-accounting' },
        ],
      },
      { type: 'heading', text: 'Tools available in your dashboard' },
      {
        type: 'list',
        items: [
          'Real-time earnings dashboard with monthly and yearly breakdowns.',
          'Calendar with drag-to-block, weekend pricing, and per-night custom rates.',
          'Booking Requests inbox with one-click accept or decline.',
          'Messages with quick replies, scheduled sends, and typing indicators.',
          'Financial Books: 6-month P&L, property profitability, and tax-ready exports.',
          'Reviews dashboard with the ability to respond to guest feedback.',
        ],
      },
    ],
    cta: { label: 'Open Host Dashboard', to: '/host/dashboard' },
  },

  'community-forum': {
    slug: 'community-forum',
    title: 'Community Forum',
    subtitle: 'Connect with thousands of Hostiva hosts around the world.',
    icon: MessageSquare,
    category: 'Hosting',
    sections: [
      { type: 'paragraph', text: 'The Hostiva Community Forum is where hosts ask questions, share what works, and learn from each other. From pricing strategy to local regulations, you\'ll find experienced hosts ready to help.' },
      { type: 'heading', text: 'Popular categories' },
      {
        type: 'cards',
        items: [
          { title: 'Getting started', desc: 'New hosts ask their first questions and get welcomed by the community.', to: '/info/forum-getting-started' },
          { title: 'Pricing & revenue', desc: 'Strategies for seasonal pricing, occupancy optimization, and dynamic pricing tools.', to: '/info/forum-pricing-revenue' },
          { title: 'Guest communication', desc: 'Templates, scripts, and approaches that have worked for top-rated hosts.', to: '/info/forum-guest-communication' },
          { title: 'Local regulations', desc: 'City-by-city threads on permits, taxes, short-term rental rules, and HOA policies.', to: '/info/forum-local-regulations' },
          { title: 'Property setup', desc: 'Furnishing on a budget, must-have amenities, and small touches that earn 5-star reviews.', to: '/info/forum-property-setup' },
          { title: 'Tech & integrations', desc: 'iCal sync, smart locks, dynamic pricing tools, and cleaning service software.', to: '/info/forum-tech-integrations' },
        ],
      },
      {
        type: 'callout',
        tone: 'info',
        title: 'Be respectful',
        text: 'The forum is moderated. Self-promotion, off-topic content, and personal attacks will be removed. Be helpful, share generously.',
      },
    ],
    cta: { label: 'Visit the forum', to: '/host/community' },
  },

  'responsible-hosting': {
    slug: 'responsible-hosting',
    title: 'Responsible Hosting',
    subtitle: 'Run your listing legally, safely, and considerately.',
    icon: Heart,
    category: 'Hosting',
    sections: [
      { type: 'paragraph', text: 'Being a great host goes beyond clean sheets and a five-star review. It means understanding your local laws, respecting your neighbors, and making sure every guest has a safe, transparent experience.' },
      { type: 'heading', text: 'Know your local rules' },
      {
        type: 'list',
        items: [
          'Check whether your city or country requires a short-term rental permit.',
          'Confirm whether your lease, HOA, or co-op agreement allows hosting.',
          'Understand your tax obligations — many cities require occupancy or tourist tax collection.',
          'Insurance: confirm whether you need a host-specific policy in addition to the Host Guarantee.',
        ],
      },
      { type: 'heading', text: 'Health & safety essentials' },
      {
        type: 'list',
        items: [
          'Working smoke and carbon monoxide detectors on every floor.',
          'A clearly labelled fire extinguisher in the kitchen.',
          'A first aid kit in an obvious location.',
          'Emergency contact numbers and the address posted near the entrance.',
          'Clear instructions for appliances, heating, and Wi-Fi.',
        ],
      },
      { type: 'heading', text: 'Be a good neighbor' },
      { type: 'paragraph', text: 'Respect quiet hours, communicate house rules clearly, and let neighbors know how to reach you if there\'s an issue. A short note introducing your hosting can prevent most complaints before they happen.' },
      {
        type: 'callout',
        tone: 'warn',
        title: 'Know your limits',
        text: 'Hostiva cannot give legal or tax advice. We strongly recommend consulting a local professional before listing.',
      },
    ],
  },

  // ---------------- HOSTIVA ----------------
  'newsroom': {
    slug: 'newsroom',
    title: 'Newsroom',
    subtitle: 'Press releases, company news, and media resources.',
    icon: Newspaper,
    category: 'Hostiva',
    sections: [
      { type: 'heading', text: 'Latest announcements' },
      {
        type: 'cards',
        items: [
          { title: 'Hostiva launches Free Cancellation Approvals', desc: 'Hosts can now approve guest free-cancellation requests directly from the messaging inbox, with real-time header notifications.' },
          { title: 'iCal auto-sync rolls out platform-wide', desc: 'All connected calendars now refresh every 2 hours automatically, with a manual refresh button and last-sync timestamps.' },
          { title: 'Financial Books module released', desc: 'Hosts get a 6-month P&L, property-level profitability, and CSV exports for tax season.' },
          { title: 'Hostiva now in 12 languages', desc: 'Including full right-to-left support for Arabic. Currency conversion follows automatically.' },
          { title: 'New Host Guarantee: $1,000,000 protection', desc: 'Zero deductible, 14-day claim window, with a streamlined 4-step claims process.' },
        ],
      },
      { type: 'heading', text: 'Media inquiries' },
      { type: 'paragraph', text: 'For press, partnerships, or interview requests, contact support@hostly.co.ke. We aim to respond within one business day.' },
      { type: 'heading', text: 'Company facts' },
      {
        type: 'list',
        items: [
          'Founded: 2024',
          'Headquarters: San Francisco, CA',
          'Active markets: 80+ countries',
          'Supported languages: 12',
          'Payment processor: Paystack (CBK authorised, PCI-DSS compliant)',
        ],
      },
    ],
  },

  'new-features': {
    slug: 'new-features',
    title: 'New Features',
    subtitle: 'Everything we\'ve shipped recently — and what\'s coming next.',
    icon: Sparkles,
    category: 'Hostiva',
    sections: [
      { type: 'heading', text: 'Recently shipped' },
      {
        type: 'cards',
        items: [
          { title: 'Cancellation request badge', desc: 'Hosts now see a pulsing alert badge in the header the moment a guest requests free cancellation.' },
          { title: 'Multi-week booking bars', desc: 'Booking bars on the host calendar now extend across week rows so you always see the full guest stay.' },
          { title: 'Weekend pricing — Fri/Sat/Sun', desc: 'Weekend pricing now correctly applies to all three weekend nights, not just Friday and Saturday.' },
          { title: 'Lightbox image fitting', desc: 'Property image lightbox now fits any aspect ratio perfectly with prominent navigation arrows.' },
          { title: 'Listing import via URL', desc: 'Paste an Airbnb or Booking.com link and Hostiva will pre-fill your listing for you to review and edit.' },
          { title: 'Mutual blind reviews', desc: 'Both guest and host reviews are hidden until both parties submit, or the 14-day window closes.' },
        ],
      },
      { type: 'heading', text: 'On the roadmap' },
      {
        type: 'list',
        items: [
          'Smart pricing suggestions based on local demand.',
          'Native iOS and Android apps.',
          'Multi-property bulk calendar editing.',
          'In-app video calls between hosts and guests.',
          'Sustainability badges for eco-friendly listings.',
        ],
      },
      {
        type: 'callout',
        tone: 'info',
        title: 'Have a feature request?',
        text: 'Post it in the Community Forum or email support@hostly.co.ke. The most-requested ideas get prioritized each quarter.',
      },
    ],
  },

  'careers': {
    slug: 'careers',
    title: 'Careers at Hostiva',
    subtitle: 'Help us build the most trusted home-sharing platform in the world.',
    icon: Briefcase,
    category: 'Hostiva',
    sections: [
      { type: 'paragraph', text: 'We\'re a remote-first team of engineers, designers, hosts, and travelers building Hostiva from 12 countries. If you care about hospitality, trust, and great software, we\'d love to hear from you.' },
      { type: 'heading', text: 'Open roles' },
      {
        type: 'cards',
        items: [
          { title: 'Senior Full-Stack Engineer', desc: 'React, TypeScript, Postgres. Remote (Americas/EMEA). Help us scale the host dashboard to 100k+ listings.' },
          { title: 'Trust & Safety Specialist', desc: 'Investigate disputes, refine fraud-detection rules, and support hosts and guests during incidents. Remote (24/7 rotation).' },
          { title: 'Product Designer', desc: 'Lead end-to-end design for the booking flow. Strong portfolio of consumer marketplace work required.' },
          { title: 'Host Success Manager', desc: 'Onboard top hosts in major markets, run webinars, and surface product feedback. Hybrid (NYC, London, or Lisbon).' },
          { title: 'Data Analyst', desc: 'Build pricing, occupancy, and host-retention models. SQL + Python required, dbt a plus.' },
          { title: 'Localization Lead', desc: 'Own translation quality across 12 languages and lead expansion to 5 new markets in 2026.' },
        ],
      },
      { type: 'heading', text: 'Why work at Hostiva' },
      {
        type: 'list',
        items: [
          'Remote-first with quarterly team off-sites.',
          'Equity in the company from day one.',
          'Annual stipend for staying at a Hostiva listing on us.',
          'Health, dental, and vision insurance for you and dependents.',
          'Paid parental leave: 16 weeks for primary, 8 for secondary.',
          'Learning budget: $2,000/year for courses, books, and conferences.',
        ],
      },
      {
        type: 'callout',
        tone: 'success',
        title: 'Don\'t see your role?',
        text: 'Send your portfolio to support@hostly.co.ke with a short note. We hire generalists too.',
      },
    ],
  },

  'investors': {
    slug: 'investors',
    title: 'Investors',
    subtitle: 'Information for current and prospective investors in Hostiva.',
    icon: TrendingUp,
    category: 'Hostiva',
    sections: [
      { type: 'paragraph', text: 'Hostiva is a privately-held company building the next generation of home-sharing infrastructure. We focus on host economics, guest trust, and operational excellence.' },
      { type: 'heading', text: 'Company highlights' },
      {
        type: 'cards',
        items: [
          { title: 'Marketplace model', desc: 'Two-sided, take-rate based: 3% host commission + variable guest service fee.' },
          { title: 'Geographic reach', desc: 'Active in 80+ countries with localized payments, currency, and language.' },
          { title: 'Trust infrastructure', desc: 'Verified profiles, encrypted messaging, $1M Host Guarantee, 24/7 support.' },
          { title: 'Tech stack', desc: 'React, TypeScript, Postgres, Paystack, Supabase. Built for scale and reliability.' },
        ],
      },
      { type: 'heading', text: 'Investor relations' },
      { type: 'paragraph', text: 'For inquiries about funding rounds, financial information, or partnership discussions, please contact support@hostly.co.ke. All material non-public information is shared under NDA.' },
      {
        type: 'callout',
        tone: 'warn',
        title: 'Forward-looking statements',
        text: 'Information on this page may include forward-looking statements based on current expectations. Actual results may differ materially. Hostiva undertakes no obligation to update these statements.',
      },
    ],
  },

  // ---------------- HELP-CENTER SUB-TOPICS ----------------
  'booking-payments': {
    slug: 'booking-payments',
    title: 'Booking & Payments',
    subtitle: 'Everything about reservations, charges, receipts, and confirmations.',
    icon: CreditCard,
    category: 'Support',
    sections: [
      { type: 'paragraph', text: 'Hostiva uses Paystack to process every reservation securely. The full booking total is captured at confirmation, and your funds are held until the host receives their payout 24 hours after your check-in.' },
      { type: 'heading', text: 'How a booking works' },
      {
        type: 'list',
        items: [
          'You select dates, guests, and add-ons on the property page — the price preview updates live with nightly rate, weekend pricing (Fri/Sat/Sun), cleaning fee, and service fee.',
          'Click "Book now" — you\'re redirected to a secure Paystack Checkout page. Hostiva never sees your card details.',
          'On successful payment, your booking moves to "confirmed" instantly via Supabase Realtime. You\'ll see the confirmation banner and receive an email receipt.',
          'The dates are blocked on the host calendar so no one else can double-book.',
          'You can message the host immediately from the confirmation page.',
        ],
      },
      { type: 'heading', text: 'Accepted payment methods' },
      {
        type: 'cards',
        items: [
          { title: 'Credit & debit cards', desc: 'Visa, Mastercard, M-Pesa, bank transfer, and more via Paystack.' },
          { title: 'Apple Pay & Google Pay', desc: 'Available automatically on supported devices during Checkout.' },
          { title: 'Bank transfers (select regions)', desc: 'SEPA in Europe, ACH in the US, and other local methods are offered when available.' },
        ],
      },
      { type: 'heading', text: 'Receipts & confirmation emails' },
      { type: 'paragraph', text: 'Every confirmed booking generates a receipt visible under My Bookings → booking detail. You can also re-download the email receipt at any time. Hostiva does not charge VAT separately — taxes shown at checkout are inclusive.' },
      { type: 'heading', text: 'Frequently asked questions' },
      {
        type: 'faq',
        items: [
          { q: 'When is my card charged?', a: 'Immediately at the time of booking. The full amount (accommodation + cleaning + service fee) is captured by Paystack.' },
          { q: 'Why is the price different on the calendar vs my booking?', a: 'Weekend nights (Friday, Saturday, Sunday) and host-set custom prices for specific dates can change the per-night rate. The total you see at checkout is final.' },
          { q: 'Can I change my booking dates?', a: 'You\'ll need to cancel and rebook. Refer to the cancellation policy for refund eligibility, then book the new dates.' },
          { q: 'I never received my confirmation email — what now?', a: 'Check your spam folder, then visit My Bookings to confirm the booking is "confirmed". If still missing, contact support@hostly.co.ke.' },
          { q: 'Is my payment information stored on Hostiva?', a: 'No. All payment data is tokenized and stored only by Paystack (PCI-DSS compliant). Hostiva only stores the booking metadata.' },
        ],
      },
      {
        type: 'callout',
        tone: 'success',
        title: 'Payments are protected',
        text: 'Funds are released to the host 24 hours after check-in, giving you a window to flag urgent issues with the support team if anything is wrong.',
      },
    ],
    cta: { label: 'View my bookings', to: '/bookings' },
  },

  'refunds-cancellations': {
    slug: 'refunds-cancellations',
    title: 'Refunds & Cancellations',
    subtitle: 'When refunds are issued, how much you get back, and how to request a free cancellation.',
    icon: RotateCcw,
    category: 'Support',
    sections: [
      { type: 'paragraph', text: 'Hostiva uses a 3-tier cancellation policy that balances guest flexibility with host protection. The refund you receive depends on how far in advance you cancel, and you can always request a free cancellation directly from your host.' },
      { type: 'heading', text: 'The 3 refund tiers' },
      {
        type: 'cards',
        items: [
          { title: '5+ days before check-in → 100% refund', desc: 'Full automatic refund of accommodation. No host approval required. Only the platform service fee is retained.' },
          { title: '3 days before check-in → 50% refund', desc: '50% refunded automatically. You may also request a free cancellation from the host for a higher refund.' },
          { title: 'Within 24 hours of check-in → 0% refund', desc: 'No automatic refund. You can still request a free cancellation — only granted if the host approves.' },
        ],
      },
      { type: 'heading', text: 'How to cancel' },
      {
        type: 'list',
        items: [
          'Open My Bookings and click "Cancel" on the reservation.',
          'You\'ll see your exact refund amount based on the tier above before anything is processed.',
          'Choose either "Cancel automatically" (instant refund per the tier) or "Request free cancellation" (sends a notification to the host).',
          'Refunds are processed back to your original payment method within 5–10 business days.',
        ],
      },
      { type: 'heading', text: 'Free cancellation requests' },
      { type: 'paragraph', text: 'When you request a free cancellation, the host receives a real-time alert badge in their header and can approve or decline directly from Messages. If approved, you receive a full refund minus the platform service fee. If declined, your standard tier refund still applies if you choose to cancel automatically.' },
      { type: 'heading', text: 'When the host cancels' },
      { type: 'paragraph', text: 'If a host cancels your confirmed booking, you receive a 100% refund automatically — including the service fee. The host is also charged a penalty (commission, tax, and service fee) and the dates are released back to the calendar.' },
      {
        type: 'callout',
        tone: 'info',
        title: 'Service fee is non-refundable on guest cancellations',
        text: 'The platform service fee covers payment processing, fraud protection, and 24/7 support. It is only refunded if the host cancels or approves your free-cancellation request.',
      },
    ],
    cta: { label: 'Manage bookings', to: '/bookings' },
  },

  'account-profile': {
    slug: 'account-profile',
    title: 'Account & Profile',
    subtitle: 'Manage your email, password, identity verification, and notification preferences.',
    icon: UserCog,
    category: 'Support',
    sections: [
      { type: 'paragraph', text: 'Your account is the home for everything you do on Hostiva — bookings, messages, favorites, listings, and trust signals. Here\'s how to keep it secure and personalized.' },
      { type: 'heading', text: 'Update personal info' },
      {
        type: 'list',
        items: [
          'Open Settings → Personal info to edit your name, bio, location, languages, and travel style.',
          'Email changes require a double confirmation: a verification link is sent to both your old and new addresses.',
          'Phone updates trigger an SMS verification code.',
          'Profile photo updates apply instantly across listings, reviews, and messages.',
        ],
      },
      { type: 'heading', text: 'Identity & trust verification' },
      {
        type: 'cards',
        items: [
          { title: 'Phone verification', desc: 'A 6-digit SMS code confirms your number. Required for hosts and recommended for guests.' },
          { title: 'Email verification', desc: 'Confirmed automatically when you sign up. Update via Settings if you change addresses.' },
          { title: 'Government ID', desc: 'Upload a passport, driver\'s license, or national ID. Reviewed by our team within 1–3 business days.' },
        ],
      },
      { type: 'heading', text: 'Security' },
      {
        type: 'list',
        items: [
          'Use a strong, unique password — at least 8 characters mixing letters, numbers, and symbols.',
          'Enable browser autofill warnings for suspicious sites.',
          'Sign out of shared devices from Settings → Security → Active sessions.',
          'If you suspect unauthorized access, immediately change your password and contact support@hostly.co.ke.',
        ],
      },
      { type: 'heading', text: 'Notifications & privacy' },
      { type: 'paragraph', text: 'Settings → Notifications lets you toggle email, SMS, and in-app alerts for messages, booking updates, price alerts, reviews, and security events. Privacy controls determine whether your trips, wishlist, and reviews are publicly visible on your profile.' },
      { type: 'heading', text: 'Frequently asked questions' },
      {
        type: 'faq',
        items: [
          { q: 'I forgot my password — what do I do?', a: 'Click "Forgot password?" on the sign-in page. A reset link is emailed instantly and expires in 1 hour.' },
          { q: 'Can I delete my account?', a: 'Yes. Go to Settings → Account → Delete account. Active bookings must be completed or cancelled first.' },
          { q: 'Why was my ID verification rejected?', a: 'Common reasons: blurry photo, expired document, or name mismatch. Upload a clearer photo and we\'ll re-review within 24 hours.' },
          { q: 'How do I export my data?', a: 'Settings → Privacy → Export my data downloads a JSON file with your bookings, messages, reviews, and profile.' },
        ],
      },
    ],
    cta: { label: 'Open settings', to: '/settings' },
  },

  'hosting-basics': {
    slug: 'hosting-basics',
    title: 'Hosting Basics',
    subtitle: 'List a property, set pricing, manage your calendar, and welcome your first guest.',
    icon: HomeIcon,
    category: 'Support',
    sections: [
      { type: 'paragraph', text: 'Becoming a Hostiva host takes about 30 minutes. Once your first listing is approved, you\'re automatically promoted to host status and gain access to the full Hosting dashboard, calendar, financial books, and earnings tools.' },
      { type: 'heading', text: 'Step-by-step: list your first space' },
      {
        type: 'list',
        items: [
          'Click "List your space" from any page or footer.',
          'Use the multi-step wizard: property type → location (pin on map) → photos → amenities → pricing → house rules → review.',
          'Add at least 5 high-quality photos. Each amenity you select can have its own photo to showcase the experience.',
          'Set your nightly rate, weekend pricing (Fri/Sat/Sun), cleaning fee, and minimum/maximum stay.',
          'Submit for review — our team approves new listings within 24 hours.',
          'Once approved, your dates open for instant or request-to-book reservations.',
        ],
      },
      { type: 'heading', text: 'Pricing & fees' },
      {
        type: 'cards',
        items: [
          { title: 'Nightly rate', desc: 'Your base price. Set it competitively by checking similar listings in your area.' },
          { title: 'Weekend pricing', desc: 'Optional uplift for Friday, Saturday, and Sunday nights. Applied automatically to qualifying dates.' },
          { title: 'Service fee allocation', desc: 'Choose who pays the platform service fee — Guest, Host, or 50/50 split. Affects your bookings\' net payout.' },
          { title: 'Custom date pricing', desc: 'Override your base rate for specific dates from the host calendar (great for holidays and peak seasons).' },
        ],
      },
      { type: 'heading', text: 'Calendar management' },
      { type: 'paragraph', text: 'The Host Calendar at /host/calendar shows a monthly grid with drag-to-select date blocking, multi-week booking bars showing guest names, and one-click iCal sync with Airbnb, Booking.com, and Vrbo. Sync runs automatically every 2 hours.' },
      { type: 'heading', text: 'Earnings & payouts' },
      {
        type: 'list',
        items: [
          'Payouts are released 24 hours after each guest checks in.',
          'Add your PayPal email under Settings → Payouts to receive funds.',
          'View your earnings dashboard at /host/earnings (revenue trends, upcoming payouts, completed bookings).',
          'For accounting, use /host/financial-books — 6-month P&L, property profitability, and CSV exports for tax season.',
        ],
      },
      {
        type: 'callout',
        tone: 'success',
        title: 'You\'re protected',
        text: 'Every booking includes the $1,000,000 Host Guarantee covering eligible damage caused by guests. No deductible.',
      },
    ],
    cta: { label: 'List your space', to: '/become-host' },
  },

  'trust-safety': {
    slug: 'trust-safety',
    title: 'Trust & Safety',
    subtitle: 'Verified profiles, secure messaging, and what to do if something goes wrong.',
    icon: ShieldCheck,
    category: 'Support',
    sections: [
      { type: 'paragraph', text: 'Trust is the foundation of every Hostiva stay. We invest in identity verification, payment security, encrypted messaging, and a dedicated support team available around the clock to keep both guests and hosts safe.' },
      { type: 'heading', text: 'How we keep you safe' },
      {
        type: 'cards',
        items: [
          { title: 'Verified identities', desc: 'Phone, email, and government ID checks display as badges on every profile so you know who you\'re dealing with.' },
          { title: 'Secure payments via Paystack', desc: 'PCI-DSS Level 1 compliance. Card details never touch Hostiva servers, and funds are escrowed until 24 hours after check-in.' },
          { title: 'Encrypted messaging', desc: 'All conversations stay inside Hostiva — we never share contact details until a booking is confirmed.' },
          { title: '$1,000,000 Host Guarantee', desc: 'Hosts are protected against eligible damage caused by guests, with no deductible.' },
          { title: '24/7 support', desc: 'Our trust & safety team is available every day for urgent issues during a stay.' },
          { title: 'Real-time fraud detection', desc: 'Paystack fraud detection plus custom ML models flag suspicious payments and account behavior.' },
        ],
      },
      { type: 'heading', text: 'If something goes wrong' },
      {
        type: 'list',
        items: [
          'Document the issue with photos or videos as soon as possible.',
          'Contact your host or guest first via the Messages tab — most issues resolve within hours.',
          'If you can\'t reach a resolution, open a Resolution Center request from your booking detail page.',
          'For emergencies that affect health or safety, contact local emergency services first, then notify Hostiva at support@hostly.co.ke or +1 872 221 7881.',
        ],
      },
      { type: 'heading', text: 'Reporting concerns' },
      { type: 'paragraph', text: 'If you encounter discrimination, harassment, suspected fraud, or a misrepresented listing, report it from the property page (•••  menu → Report this listing) or from the user\'s profile. Our team reviews every report within 24 hours and takes action including warnings, suspensions, or permanent removal.' },
      {
        type: 'callout',
        tone: 'warn',
        title: 'Never pay outside Hostiva',
        text: 'If a host or guest asks you to pay or communicate off-platform, decline and report it. Off-platform transactions are not protected by the Host Guarantee, refund policy, or payment dispute process.',
      },
    ],
    cta: { label: 'Read SafetyStay', to: '/info/safety' },
  },

  'reviews-ratings': {
    slug: 'reviews-ratings',
    title: 'Reviews & Ratings',
    subtitle: 'How the dual-blind review system keeps feedback honest for both guests and hosts.',
    icon: Star,
    category: 'Support',
    sections: [
      { type: 'paragraph', text: 'Hostiva uses a dual-blind mutual review architecture: guests review the property and host, and hosts review the guest. Neither party sees the other\'s review until both are submitted, or the 14-day review window closes — whichever comes first. This protects honest feedback from retaliation.' },
      { type: 'heading', text: 'How it works' },
      {
        type: 'list',
        items: [
          'After checkout, both guest and host receive a notification to leave a review.',
          'You have 14 days to submit. Reviews submitted after the window are not published.',
          'Neither side can see the other\'s rating or comment until both have submitted (or the window closes).',
          'Once published, reviews appear on the property page (guest-to-property) and on the user\'s public profile (mutual ratings).',
          'Hosts can post a public reply under each property review.',
        ],
      },
      { type: 'heading', text: 'What\'s rated' },
      {
        type: 'cards',
        items: [
          { title: 'Property reviews (guest → property)', desc: 'Overall, cleanliness, accuracy, communication, location, check-in, and value — each on a 5-star scale, plus a written comment.' },
          { title: 'Mutual reviews (guest ↔ host)', desc: 'Overall, communication, cleanliness (of behavior), location etiquette, and security — building trust between users across stays.' },
          { title: 'Host responses', desc: 'Hosts can publicly reply to property reviews to clarify or thank guests.' },
        ],
      },
      { type: 'heading', text: 'Review guidelines' },
      {
        type: 'list',
        items: [
          'Be honest, specific, and constructive — describe what happened, not personal attacks.',
          'Don\'t include private information (full names, contact details, addresses).',
          'No discriminatory, threatening, or sexually explicit content.',
          'Don\'t mention competitors or off-platform services.',
          'Reviews are final and cannot be edited after submission. Hostiva only removes reviews that violate these guidelines.',
        ],
      },
      { type: 'heading', text: 'Frequently asked questions' },
      {
        type: 'faq',
        items: [
          { q: 'When does my review get published?', a: 'Either when both you and the other party submit, or when the 14-day window closes. Whichever comes first.' },
          { q: 'Can I see the other person\'s review before I submit mine?', a: 'No. The blind system prevents retaliation and keeps feedback honest.' },
          { q: 'Can I edit my review after submitting?', a: 'No. Reviews are final once submitted. Take time to write thoughtfully before clicking submit.' },
          { q: 'Can a host pay to remove a bad review?', a: 'Absolutely not. Hostiva does not allow paid review removal under any circumstances.' },
          { q: 'I received a review that violates the guidelines — what now?', a: 'Click "Report" under the review. Our team reviews every report within 48 hours.' },
        ],
      },
      {
        type: 'callout',
        tone: 'info',
        title: 'Reviews build the community',
        text: 'Honest reviews help future guests choose great stays and help hosts improve. Take a few minutes — your feedback matters.',
      },
    ],
    cta: { label: 'Open my bookings', to: '/bookings' },
  },

  // ---------------- HOSTING SUB-GUIDES ----------------
  'host-pricing': {
    slug: 'host-pricing',
    title: 'Pricing Your Listing',
    subtitle: 'Set rates that fill your calendar and grow your revenue — without leaving money on the table.',
    icon: DollarSign,
    category: 'Hosting',
    sections: [
      { type: 'paragraph', text: 'Pricing is the single biggest lever in short-term rental revenue. The right nightly rate balances occupancy (how many nights are booked) against ADR (the average price per night). Hostiva\'s Host Calendar gives you per-night control, weekend uplifts, and minimum-stay rules so you can react to demand without leaving the platform.' },

      { type: 'heading', text: 'Start with a base rate' },
      { type: 'paragraph', text: 'Your base rate is the price you set in step 7 of the property wizard. Begin by researching 5–10 comparable listings in your city: same property type, same number of bedrooms, similar amenities, and similar review count. Aim to land within 10–15% of the median for new listings, slightly below if you have under 5 reviews — competitive pricing is the fastest way to build review velocity.' },
      {
        type: 'list',
        items: [
          'Open Search → filter by city, property type, and bedroom count.',
          'Note the nightly rate of the top 10 results sorted by rating.',
          'Calculate the median (middle value, not average — outliers skew averages).',
          'Set your base 10–15% below the median for the first 30 days, then raise as reviews accumulate.',
        ],
      },

      { type: 'heading', text: 'Use weekend pricing (Fri–Sun)' },
      { type: 'paragraph', text: 'Demand for short-term rentals spikes Friday and Saturday nights in most markets. Hostiva\'s Host Calendar lets you set a weekend uplift that automatically applies to every Friday, Saturday, and Sunday night — no manual editing required. A 15–25% uplift is typical for leisure markets; 10–15% for business-travel cities.' },
      {
        type: 'list',
        items: [
          'Go to Host → Calendar.',
          'Open the pricing settings panel (top-right).',
          'Toggle "Weekend pricing" on and enter a percentage uplift (e.g. 20%).',
          'The calendar grid will visually show weekend nights at the higher price.',
          'Override individual nights by clicking a date and entering a custom rate.',
        ],
      },

      { type: 'heading', text: 'Seasonal pricing' },
      { type: 'paragraph', text: 'Identify your high, shoulder, and low seasons. For most leisure destinations, summer + holiday weeks are high (raise 30–60%), spring/fall are shoulder (base rate), and winter weekdays are low (drop 15–25%). Use the calendar drag-to-select feature to apply seasonal rates across long date ranges in one click.' },

      { type: 'heading', text: 'Last-minute discounts' },
      { type: 'paragraph', text: 'An empty night earns nothing. If a date is still open within 7 days of check-in, drop the rate by 10–20% to capture last-minute travelers. You can override individual nights in the Host Calendar without changing your base rate.' },

      { type: 'heading', text: 'Length-of-stay strategy' },
      {
        type: 'list',
        items: [
          'Set minimum nights = 2 to filter out one-night stays that increase wear and turnover costs.',
          'Use minimum nights = 3 on weekends in high season to avoid Friday-only bookings that block the weekend.',
          'Offer weekly (7+ nights) and monthly (28+ nights) discounts of 10% and 20% to attract longer, more profitable stays.',
        ],
      },

      { type: 'heading', text: 'Common mistakes to avoid' },
      {
        type: 'list',
        items: [
          'Pricing too high before earning reviews — new listings need momentum.',
          'Forgetting to raise prices for local events, holidays, or peak season.',
          'Setting cleaning fees too high relative to nightly rate (rule of thumb: <30% of one night).',
          'Ignoring the calendar for weeks at a time — Hostiva does not auto-price.',
        ],
      },

      { type: 'heading', text: 'Frequently asked questions' },
      {
        type: 'faq',
        items: [
          { q: 'Does Hostiva offer dynamic/automatic pricing?', a: 'Not yet. All pricing is set manually in your Host Calendar. We recommend reviewing your rates weekly during high season and monthly during low season.' },
          { q: 'Can I price in a currency other than USD?', a: 'Yes. Set your property currency in step 7 of the wizard. All payouts and accounting reflect that currency.' },
          { q: 'How do service fees affect my displayed price?', a: 'You decide in step 7 whether the service fee is paid by the guest, by you (the host), or split 50/50. Guest-paid fees are added on top of your nightly rate at checkout; host-paid fees are deducted from your payout.' },
          { q: 'Will lowering my price hurt my ranking?', a: 'No. Hostiva\'s search ranks by rating, response time, and recent booking activity — competitive pricing helps you accumulate the bookings that fuel ranking.' },
        ],
      },

      { type: 'callout', tone: 'success', title: 'Quick win', text: 'Drop your base rate by 10% for the next 30 days, enable a 20% weekend uplift, and watch your booking velocity climb. You can always raise prices once reviews accumulate.' },
    ],
    cta: { label: 'Open Host Calendar', to: '/host/calendar' },
  },

  'host-photography': {
    slug: 'host-photography',
    title: 'Photography That Converts',
    subtitle: 'A 12-photo checklist, lighting tips, and the wide-angle shots that turn scrollers into bookers.',
    icon: Camera,
    category: 'Hosting',
    sections: [
      { type: 'paragraph', text: 'Photos are the first impression of your listing — the cover image alone determines whether a guest clicks through. High-quality, well-lit photos increase click-through rates by 30–60% and are the single biggest predictor of booking conversion on every short-term rental marketplace, including Hostiva.' },

      { type: 'heading', text: 'The 12-photo checklist' },
      { type: 'paragraph', text: 'These 12 shots cover every angle a guest needs to make a booking decision. Aim for landscape orientation (wider than tall) and a minimum resolution of 1920×1080 — Hostiva accepts up to 5MB per image and you can upload as many as you want, but the first 12 do the heavy lifting.' },
      {
        type: 'list',
        items: [
          '1. Hero shot — the best room or exterior, taken from a wide angle, in golden-hour light. This becomes your cover photo.',
          '2. Living room — wide angle, doorway shot, all lights on.',
          '3. Kitchen — countertops cleared, appliances clean, fruit bowl or coffee setup adds warmth.',
          '4. Dining area — table set with glasses or a small flower arrangement.',
          '5. Master bedroom — wide angle from doorway, bed made with crisp linens.',
          '6. Each additional bedroom — same approach as master.',
          '7. Each bathroom — wide angle, fresh towels rolled and stacked.',
          '8. Outdoor space — patio, balcony, garden, or pool with furniture arranged.',
          '9. Pool / hot tub / unique amenity — close enough to feel inviting, wide enough to show context.',
          '10. Workspace — desk with chair, lamp, and a clear power outlet visible (remote workers love this).',
          '11. Neighborhood / view — what guests see when they step outside or look out the window.',
          '12. Welcome detail — a small touch like a coffee station, welcome basket, or local guidebook.',
        ],
      },

      { type: 'heading', text: 'Lighting tips' },
      {
        type: 'list',
        items: [
          'Shoot during the day with all curtains and blinds open.',
          'Turn ON every interior light — even during daytime — to add warmth and remove shadows.',
          'Avoid harsh midday sun on south-facing windows. Shoot mornings or late afternoon.',
          'For exterior shots, use golden hour (the hour after sunrise or before sunset).',
          'Turn off ceiling fans and TVs — moving blades and screens look distracting in stills.',
        ],
      },

      { type: 'heading', text: 'Composition fundamentals' },
      {
        type: 'list',
        items: [
          'Stand in a corner of the room and shoot diagonally — this captures the full space.',
          'Hold the camera at chest height (around 1.2m / 4ft), parallel to the floor.',
          'Use a wide-angle lens (16–24mm equivalent) but avoid extreme fish-eye distortion.',
          'Keep vertical lines vertical — tilting the camera up makes walls look like they\'re falling backward.',
          'Include a foreground element (chair, table corner) to add depth.',
        ],
      },

      { type: 'heading', text: 'Staging the space' },
      {
        type: 'list',
        items: [
          'Make every bed with hotel-style precision: tight sheets, plumped pillows, smooth duvet.',
          'Clear ALL personal items — toothbrushes, mail, family photos, fridge magnets.',
          'Hide cables, charging bricks, and remotes — or arrange them neatly.',
          'Add fresh flowers, a fruit bowl, or a styled coffee tray for warmth.',
          'Open shower curtains halfway and roll towels rather than folding.',
        ],
      },

      { type: 'heading', text: 'Phone vs DSLR' },
      { type: 'paragraph', text: 'Modern smartphones (iPhone 13+, Pixel 6+, Samsung S22+) shoot listing-quality photos in good light. Use the ultra-wide lens for room shots, and the main lens for detail shots. If your space is dark, narrow, or has unusual angles, hire a local real estate photographer for $150–$400 — the ROI typically pays back in the first 2–3 bookings.' },

      { type: 'heading', text: 'Uploading to Hostiva' },
      {
        type: 'list',
        items: [
          'In the property wizard step 4 (Cover Photo) and step 5 (additional photos), drag and drop or click to upload.',
          'Reorder photos by dragging — the first photo becomes your search-results cover image.',
          'For each amenity in step 5, you can attach proof photos (e.g. a photo of the pool when you select "Pool"). Amenity photos build trust.',
          'Photos are stored in Hostiva Cloud and served via CDN — no separate hosting required.',
        ],
      },

      { type: 'heading', text: 'Common mistakes' },
      {
        type: 'list',
        items: [
          'Vertical phone shots — they crop badly in search results.',
          'Heavy filters or oversaturated colors that don\'t match reality (leads to bad reviews).',
          'Photos taken at night with flash — looks cheap and dated.',
          'Cluttered countertops, unmade beds, visible dirt or pet hair.',
          'Skipping the bathroom — guests scroll for it.',
        ],
      },

      { type: 'callout', tone: 'success', title: 'The 30-second rule', text: 'A guest spends 30 seconds skimming your photos before deciding to read the description. If your first 4 photos don\'t hook them, they won\'t scroll further. Lead with your strongest shot.' },
    ],
    cta: { label: 'Edit your listing', to: '/host/dashboard' },
  },

  'host-description': {
    slug: 'host-description',
    title: 'Writing a Winning Description',
    subtitle: 'The opening line, amenity list, and neighborhood paragraph that turn views into bookings.',
    icon: PenLine,
    category: 'Hosting',
    sections: [
      { type: 'paragraph', text: 'Your title and description appear after the photos and before the booking widget. Together they answer the guest\'s biggest question: "Will I love staying here?" A clear, specific, and emotionally resonant description can lift conversion by 20–40% compared to a generic one.' },

      { type: 'heading', text: 'The title (60 characters)' },
      { type: 'paragraph', text: 'Hostiva titles are limited to roughly 60 characters and are the only text shown in search results alongside your cover photo. Lead with the property\'s most unique selling point, not its location (the city is shown separately).' },
      {
        type: 'list',
        items: [
          '✅ Good: "Sun-drenched loft with rooftop terrace + city views"',
          '✅ Good: "Designer cottage steps from the beach, sleeps 4"',
          '❌ Avoid: "Beautiful apartment in great location"',
          '❌ Avoid: "Apartment 2BR 1BA WiFi parking"',
          'Lead with adjectives that evoke a feeling (sun-drenched, cozy, designer, modern, secluded).',
          'Mention one standout feature (rooftop, beachfront, hot tub, view).',
          'Specify size only if it\'s a selling point (sleeps 6, 2-bedroom, family-sized).',
        ],
      },

      { type: 'heading', text: 'The opening paragraph (the hook)' },
      { type: 'paragraph', text: 'Your first 2–3 sentences are critical — they appear in search-engine snippets and at the top of the listing page. Paint a picture of the experience, not the apartment. Address the type of guest you want (couples, families, remote workers) and the trip type (weekend getaway, week-long retreat, business travel).' },
      {
        type: 'list',
        items: [
          'Start with a sensory detail: morning light, ocean breeze, the smell of fresh coffee.',
          'Name the type of trip and guest: "Perfect for a quiet weekend escape for two."',
          'Mention the standout location feature in one phrase: "5 minutes walk to the beach."',
          'Avoid clichés like "home away from home" or "everything you need" — they signal generic.',
        ],
      },

      { type: 'heading', text: 'The amenities paragraph' },
      { type: 'paragraph', text: 'After the hook, list what\'s inside in scannable, comma-separated phrases. Amenities you\'ve already ticked in step 5 of the wizard appear as icons elsewhere on the page — your description should add color and context, not duplicate the list.' },
      {
        type: 'list',
        items: [
          'Group amenities into themes: cooking (kitchen, espresso machine, dishwasher), comfort (king bed, blackout curtains, AC), and entertainment (smart TV, board games, vinyl collection).',
          'Mention brand names when relevant (Nespresso, Sonos, Casper mattress) — these signal quality.',
          'Call out remote-work readiness: fast WiFi (state the actual Mbps), monitor, ergonomic chair.',
          'Note family-friendly features: high chair, crib, pack-and-play, baby gate.',
        ],
      },

      { type: 'heading', text: 'The neighborhood paragraph' },
      { type: 'paragraph', text: 'Guests want to know what\'s within walking distance. Be specific — name actual restaurants, parks, beaches, transit stops, and attractions. Specificity builds trust that you actually live here (or know it well).' },
      {
        type: 'list',
        items: [
          'List 3–5 nearby points of interest with walking time: "5-min walk to Café Lumière, 10-min to Riverside Park, 15-min to the metro."',
          'Mention transit options and approximate times to the airport or city center.',
          'Note the neighborhood vibe: quiet residential, lively nightlife, beach town, mountain village.',
          'Add a local insider tip — the best bakery, the hidden viewpoint, the Sunday market.',
        ],
      },

      { type: 'heading', text: 'House rules and expectations' },
      { type: 'paragraph', text: 'House rules selected in step 8 of the wizard appear as chips on the listing page. Use the description to explain anything important upfront so guests self-select the right way: quiet hours, pet policy, party policy, check-in process, parking arrangement.' },

      { type: 'heading', text: 'Length and formatting' },
      {
        type: 'list',
        items: [
          'Aim for 250–500 words total — long enough to inform, short enough to read.',
          'Use short paragraphs (2–4 sentences) separated by blank lines.',
          'Avoid ALL CAPS, emoji walls, or excessive exclamation marks.',
          'Write in second person ("you\'ll wake up to…") — it\'s warmer than third person.',
        ],
      },

      { type: 'heading', text: 'SEO-friendly phrasing' },
      { type: 'paragraph', text: 'Hostiva\'s search and Google both index your title and description. Naturally include the neighborhood name, property type, and 1–2 trip-type keywords (e.g. "family vacation rental in Mombasa", "downtown business stay") without keyword-stuffing.' },

      { type: 'heading', text: 'Frequently asked questions' },
      {
        type: 'faq',
        items: [
          { q: 'Can I edit my description after publishing?', a: 'Yes. From Host → Dashboard, click any active listing and select "Edit". Changes are live immediately and do not require re-approval unless you change the property type or address.' },
          { q: 'How long can my description be?', a: 'Hostiva does not enforce a hard limit, but we recommend 250–500 words. Anything longer rarely gets read.' },
          { q: 'Can I include external links (my own website, social media)?', a: 'No. Per our community standards, contact details and external links are not allowed in listing content. They will be removed during review.' },
          { q: 'Should I write the description in multiple languages?', a: 'Hostiva automatically translates listings into all 12 supported languages. Write your description in one language and our system handles the rest — but for nuanced local references, you can manually add translations from your edit page.' },
        ],
      },

      { type: 'callout', tone: 'info', title: 'Read it out loud', text: 'Before you publish, read your description out loud. If you stumble or feel bored, your guest will too. Cut, rewrite, simplify.' },
    ],
    cta: { label: 'Edit your listing', to: '/host/dashboard' },
  },

  'host-calendar-sync': {
    slug: 'host-calendar-sync',
    title: 'Calendar & iCal Sync',
    subtitle: 'Connect Airbnb, Booking.com, and Vrbo to prevent double bookings. Auto-sync runs every 2 hours.',
    icon: CalendarDays,
    category: 'Hosting',
    sections: [
      { type: 'paragraph', text: 'If you list your property on more than one platform, calendar sync is non-negotiable. A double booking damages your reputation, forces you to cancel a guest, and triggers cancellation penalties. Hostiva\'s Host Calendar supports two-way iCal sync with every major platform — Airbnb, Booking.com, Vrbo, Expedia, and any other service that exposes a standard iCal (.ics) feed.' },

      { type: 'heading', text: 'How iCal sync works' },
      { type: 'paragraph', text: 'iCal is a standard calendar feed format (.ics file served over HTTPS). Each booking is published as a VEVENT with a check-in and check-out date. Hostiva imports VEVENT entries from external calendars and treats them as blocked nights on your Hostiva calendar — so the dates can\'t be double-booked. We also publish your Hostiva bookings as a feed that you can import into other platforms for the reverse direction.' },

      { type: 'heading', text: 'Setting up sync (5 minutes)' },
      {
        type: 'list',
        items: [
          'Open Host → Calendar.',
          'Click the "Calendar Sync" button (top-right).',
          'Copy your Hostiva Export URL — paste this into Airbnb, Booking.com, and Vrbo as an "Import calendar" feed.',
          'On each external platform, copy that platform\'s Export URL.',
          'Paste each external URL into Hostiva\'s "Import calendar" section. Give each one a label (e.g. "Airbnb", "Booking.com").',
          'Save. The first sync runs immediately; subsequent syncs run automatically every 2 hours.',
        ],
      },

      { type: 'heading', text: 'Platform-specific instructions' },
      { type: 'paragraph', text: 'Each platform locates its iCal feed in a slightly different place. Here are direct paths:' },
      {
        type: 'list',
        items: [
          'Airbnb: Listing → Pricing & availability → Sync calendars → "Export calendar" / "Import calendar".',
          'Booking.com: Property → Calendar & pricing → Sync calendars (iCal).',
          'Vrbo / HomeAway: Calendar → Reservation manager → "Import" or "Export".',
          'Expedia / Hotels.com: Property dashboard → Calendar → External calendars.',
          'Smoobu, Hospitable, Hostaway: All expose standard iCal feeds in their channel manager UI.',
        ],
      },

      { type: 'heading', text: 'How often does sync run?' },
      { type: 'paragraph', text: 'Hostiva polls every imported iCal feed every 2 hours. This is the same cadence Airbnb, Booking.com, and Vrbo use. In rare cases, two simultaneous bookings made on different platforms within the 2-hour gap can both succeed — this is an industry-wide limitation of polling-based iCal. To eliminate the risk entirely, set Instant Booking off on at least one platform during your highest-demand season.' },

      { type: 'heading', text: 'What you can edit on the Hostiva calendar' },
      {
        type: 'list',
        items: [
          'Block individual nights or date ranges (drag-to-select).',
          'Set custom per-night prices that override your base rate.',
          'Apply weekend pricing uplift (Fri/Sat/Sun).',
          'Set minimum and maximum stay rules per date.',
          'View confirmed Hostiva bookings color-coded by status.',
          'View imported external bookings as gray "blocked" cells with the source platform label.',
        ],
      },

      { type: 'heading', text: 'Troubleshooting' },
      {
        type: 'list',
        items: [
          'Dates not appearing? Sync runs every 2 hours — wait at least one cycle, or click "Sync now" to force a refresh.',
          'Wrong platform showing as the source? Check the import label you assigned in Calendar Sync.',
          'External calendar shows your Hostiva bookings 2 hours late? That\'s the external platform\'s polling cadence, not Hostiva\'s.',
          'A booking went through despite blocked dates? Open a support ticket immediately — we will help you cancel and document the platform conflict.',
        ],
      },

      { type: 'heading', text: 'Best practices' },
      {
        type: 'list',
        items: [
          'Connect every platform you list on, in both directions, before going live.',
          'Set a minimum 1-night buffer between bookings on every platform during high season.',
          'Test the sync by booking a fake date on one platform and verifying it appears on Hostiva within 2 hours.',
          'If you go on vacation or stop hosting temporarily, block the dates on Hostiva first — they\'ll propagate to other platforms.',
        ],
      },

      { type: 'heading', text: 'Frequently asked questions' },
      {
        type: 'faq',
        items: [
          { q: 'Is iCal sync free on Hostiva?', a: 'Yes. Calendar sync is included in every Hostiva host account at no additional cost.' },
          { q: 'How many external calendars can I sync?', a: 'Unlimited. Import a feed from every platform you list on.' },
          { q: 'Does Hostiva support Channel Manager APIs (not just iCal)?', a: 'Currently we support standard iCal only. Direct API integrations with Airbnb and Booking.com are on our roadmap.' },
          { q: 'What information is shared via iCal?', a: 'Only the check-in and check-out dates and a generic "Reserved" label. Guest names, contact details, and prices are never shared via iCal.' },
        ],
      },

      { type: 'callout', tone: 'warn', title: 'Always sync both directions', text: 'A one-way import only protects one calendar. Set up both export AND import on every platform for true bidirectional protection.' },
    ],
    cta: { label: 'Open Host Calendar', to: '/host/calendar' },
  },

  'host-reviews': {
    slug: 'host-reviews',
    title: 'Handling Reviews',
    subtitle: 'How the dual-blind system works and how to respond to feedback like a Superhost.',
    icon: MessageSquareText,
    category: 'Hosting',
    sections: [
      { type: 'paragraph', text: 'Reviews are the lifeblood of your listing. They drive search ranking, conversion, and repeat business. Hostiva\'s dual-blind review system is designed to keep feedback honest in both directions — so guests trust what they read, and hosts trust the guests they accept.' },

      { type: 'heading', text: 'The dual-blind architecture' },
      { type: 'paragraph', text: 'After every completed stay, both you (the host) and the guest receive a notification to leave a review. Neither side can see the other\'s review until both have submitted, OR the 14-day review window closes — whichever comes first. This prevents retaliation and keeps the feedback loop honest.' },
      {
        type: 'list',
        items: [
          'Property review (guest → property): overall rating + cleanliness, accuracy, communication, location, check-in, value, and a written comment.',
          'Mutual review (host → guest, guest → host): overall + communication, cleanliness, location etiquette, security — building user reputation across stays.',
          'You have 14 days from checkout to submit. After that, your review window closes and your stars cannot be left.',
          'Once both submit (or the window closes), reviews go public on the property page and on each user\'s public profile.',
        ],
      },

      { type: 'heading', text: 'How to respond to reviews' },
      { type: 'paragraph', text: 'Every property review can have one public host response. Use it. Future guests read both the review AND your response — your reply is a chance to demonstrate professionalism, address concerns, or simply thank a guest publicly.' },

      { type: 'heading', text: 'Responding to a 5-star review' },
      {
        type: 'list',
        items: [
          'Thank them by name (first name only).',
          'Reference one specific thing they mentioned.',
          'Invite them back warmly without pressure.',
          'Example: "Thank you, Maya! We\'re thrilled the rooftop sunsets lived up to the photos. You\'re welcome back any time."',
        ],
      },

      { type: 'heading', text: 'Responding to a 3 or 4-star review' },
      {
        type: 'list',
        items: [
          'Acknowledge the issue without making excuses.',
          'Briefly explain what\'s changed (if anything has).',
          'End on a positive note about their stay.',
          'Example: "Thanks for the honest feedback, Sam. We\'ve since replaced the bedroom blackout curtains with thicker ones for better sleep. Glad you enjoyed the kitchen — hope to host you again."',
        ],
      },

      { type: 'heading', text: 'Responding to a 1 or 2-star review' },
      {
        type: 'list',
        items: [
          'Take 24 hours before responding — write a draft, sleep on it, then post.',
          'Stay calm, factual, and brief. Never argue or insult.',
          'Apologize for the experience, acknowledge what went wrong, state what you\'ve changed.',
          'Do NOT share private details about the guest, payment disputes, or contact information.',
          'Example: "I\'m sorry your stay didn\'t meet expectations. The cleaning issue was a one-off scheduling error and we\'ve since added a second pre-arrival inspection. Thank you for bringing it to our attention."',
        ],
      },

      { type: 'heading', text: 'Reviewing your guest' },
      { type: 'paragraph', text: 'Mutual reviews build the trust network for future hosts. Be honest but professional. Rate communication, cleanliness of behavior (did they leave the place tidy?), and overall guest behavior. A 5-star guest review is a green light for other hosts; a 3-star or below is a yellow flag.' },

      { type: 'heading', text: 'When Hostiva removes a review' },
      { type: 'paragraph', text: 'Hostiva only removes reviews that violate our content policy: discriminatory language, threats, sexually explicit content, private information disclosure, off-platform contact attempts, or proven extortion. We do not remove reviews simply because they are negative. Report a policy-violating review by clicking "Report" beneath it.' },

      { type: 'heading', text: 'Boosting review velocity' },
      {
        type: 'list',
        items: [
          'Send a thank-you message via Hostiva Messages 24 hours after checkout, asking the guest to share their experience.',
          'Make checkout easy and pleasant — frustrated checkouts produce frustrated reviews.',
          'Leave a small parting gift or note. Specific, memorable details get mentioned in reviews.',
          'Submit YOUR review of the guest within 48 hours of checkout — this nudges them to reciprocate.',
        ],
      },

      { type: 'heading', text: 'Frequently asked questions' },
      {
        type: 'faq',
        items: [
          { q: 'Can I edit my review or response after submitting?', a: 'Reviews and responses are final once submitted. Take time to read your draft before clicking submit.' },
          { q: 'How long is the review window?', a: '14 days from checkout. After 14 days, neither side can submit.' },
          { q: 'Can I see what the guest wrote before I submit my review?', a: 'No. The blind system prevents either side from seeing the other\'s feedback until both have submitted (or the window closes).' },
          { q: 'A guest is threatening a bad review unless I give them a refund — what do I do?', a: 'This is extortion and violates our terms. Document the messages, refuse the refund, and report the guest immediately. We will remove any retaliatory review.' },
          { q: 'Where do reviews appear?', a: 'Property reviews show on the property page; mutual reviews show on each user\'s public profile (/user/:id). Both feed into your average rating displayed in search results.' },
        ],
      },

      { type: 'callout', tone: 'success', title: 'Respond to every review', text: 'Hosts who respond to 100% of reviews — positive AND negative — earn 23% more bookings on average. It signals you care, even when nobody\'s rating is perfect.' },
    ],
    cta: { label: 'Open Reviews dashboard', to: '/host/reviews' },
  },

  'host-tax-accounting': {
    slug: 'host-tax-accounting',
    title: 'Tax & Accounting',
    subtitle: 'Use the Financial Books module to track every payout, expense, and deductible — exportable to CSV.',
    icon: Calculator,
    category: 'Hosting',
    sections: [
      { type: 'paragraph', text: 'Hostiva\'s Financial Books module is built for hosts who treat their property as a business. Every booking, payout, refund, service fee, and platform commission is logged automatically. You can also add manual expense entries (cleaning, maintenance, supplies, utilities) and produce a 6-month profit-and-loss statement in seconds — exportable to CSV for your accountant or tax software.' },

      { type: 'heading', text: 'What\'s tracked automatically' },
      {
        type: 'list',
        items: [
          'Every booking: nightly rate, cleaning fee, total revenue, platform commission, host tax, host payout.',
          'Every refund: amount, reason, refund date, impact on net revenue.',
          'Every payout: status (pending, paid), processing date, transaction reference.',
          'Cancellation entries: who cancelled, penalty applied (if any), net result.',
          'All entries are categorized: revenue, commission, tax, refund, payout, custom expense.',
        ],
      },

      { type: 'heading', text: 'Adding manual expenses' },
      { type: 'paragraph', text: 'Hostiva does not see your offline costs (cleaners, repairs, supplies, utilities, mortgage interest). Add them manually so your P&L reflects true profitability.' },
      {
        type: 'list',
        items: [
          'Open Host → Financial Books.',
          'Click "Add Entry" → choose category: Cleaning, Maintenance, Utilities, Supplies, Insurance, Mortgage, Property Tax, Marketing, or Other.',
          'Enter amount, date, optional notes, and link the entry to a specific property if applicable.',
          'Manual entries appear in your P&L and exports alongside system-generated entries, with an "is_system_generated = false" flag.',
        ],
      },

      { type: 'heading', text: 'The 6-month P&L view' },
      { type: 'paragraph', text: 'Financial Books displays a rolling 6-month profit-and-loss summary by default. Filter by property, by category, or by custom date range. Totals are calculated live from the underlying ledger — no spreadsheets, no manual math.' },
      {
        type: 'list',
        items: [
          'Gross revenue: total booking value before fees.',
          'Platform commission: what Hostiva retained.',
          'Service fees: what was charged to you (host) vs charged to guest.',
          'Refunds issued: deducted from gross.',
          'Manual expenses: added together by category.',
          'Net profit: gross revenue minus all deductions.',
        ],
      },

      { type: 'heading', text: 'Property profitability report' },
      { type: 'paragraph', text: 'If you host more than one property, the per-property profitability report ranks every listing by net profit, occupancy, and ADR (average daily rate). Use it to identify under-performing listings to re-price, re-photograph, or delist.' },

      { type: 'heading', text: 'Exporting for taxes' },
      {
        type: 'list',
        items: [
          'From Financial Books, click "Export CSV".',
          'Choose date range (e.g. full calendar year for tax filing).',
          'CSV includes: date, category, description, amount, currency, property, booking ID, and notes.',
          'Open in Excel, Google Sheets, QuickBooks, Xero, or hand directly to your accountant.',
          'Currency totals are preserved per-row — useful for hosts operating across multiple currencies.',
        ],
      },

      { type: 'heading', text: 'Tax categories most hosts should track' },
      {
        type: 'list',
        items: [
          'Income: gross booking revenue (before commission and fees).',
          'Platform commission and service fees: deductible business expense.',
          'Cleaning fees paid to a cleaner: pass-through if charged to guest, deductible if absorbed.',
          'Maintenance and repairs: fully deductible in the year incurred.',
          'Utilities allocated to short-term rental use (electricity, water, internet, gas).',
          'Insurance premiums: short-term rental policy is fully deductible.',
          'Mortgage interest, property tax, and depreciation: usually deductible — consult your local tax advisor.',
          'Supplies: linens, towels, toiletries, coffee, welcome gifts.',
        ],
      },

      { type: 'heading', text: 'Important disclaimer' },
      { type: 'callout', tone: 'warn', title: 'We are not your accountant', text: 'Hostiva\'s Financial Books module is a tracking and reporting tool. It is not tax advice. Every host operates independently and must comply with their own country, state, and city tax obligations. Consult a qualified tax professional for advice on deductions, GST/VAT, occupancy taxes, and reporting requirements.' },

      { type: 'heading', text: 'Local taxes guests pay' },
      { type: 'paragraph', text: 'In some jurisdictions, you are responsible for collecting and remitting occupancy tax, tourist tax, GST, or VAT. Hostiva does not currently auto-collect these — you must build them into your nightly rate or charge them via your custom service fees, then remit yourself. Check with your local tax authority.' },

      { type: 'heading', text: 'Frequently asked questions' },
      {
        type: 'faq',
        items: [
          { q: 'Does Hostiva issue 1099s, T4As, or other tax forms?', a: 'Hostiva provides a complete CSV export of every transaction. Year-end tax form issuance varies by region — check your country\'s requirements with your tax advisor.' },
          { q: 'Can I track expenses for properties listed on other platforms too?', a: 'Yes. Add manual expense entries with the property they apply to, regardless of where the booking originated. The expense becomes part of that property\'s P&L.' },
          { q: 'How long is data retained?', a: 'All financial records are retained for the lifetime of your Hostiva account. Export regularly as a backup.' },
          { q: 'Can I edit a system-generated entry?', a: 'No. Bookings, payouts, and refunds are immutable. You can add a corresponding manual entry to offset or annotate.' },
          { q: 'Are payouts in my local currency?', a: 'Payouts are issued in the currency you set on each property. Multi-currency hosts can filter Financial Books by currency to see per-currency P&L.' },
        ],
      },

      { type: 'callout', tone: 'info', title: 'Run your books monthly', text: 'Set a 30-minute calendar reminder on the 1st of every month to review the previous month\'s entries, add manual expenses while they\'re fresh, and export a backup CSV. Your future tax-time self will thank you.' },
    ],
    cta: { label: 'Open Financial Books', to: '/host/financial-books' },
  },

  // ---------------- COMMUNITY FORUM SUB-PAGES ----------------
  'forum-getting-started': {
    slug: 'forum-getting-started',
    title: 'Getting started',
    subtitle: 'New hosts ask their first questions and get welcomed by the community.',
    icon: Sparkles,
    category: 'Community Forum',
    sections: [
      { type: 'paragraph', text: 'The Getting Started category is the front door of the Hostiva Community Forum. It\'s where brand-new hosts post their first questions, share their listing for feedback, and meet other hosts at the same stage. Veteran hosts and Hostiva moderators actively monitor this category to make sure no question goes unanswered.' },
      { type: 'heading', text: 'What to post here' },
      {
        type: 'list',
        items: [
          'Your "I just published my first listing!" introduction — share the city and property type, not the URL.',
          'Questions about the listing wizard, draft state, or admin approval timing (24-48 hours).',
          'Feedback requests on your title, description, or first batch of photos.',
          'Confusion about commission, service fees, taxes, and the host payout schedule (paid 24h after check-in).',
          'How instant booking vs request-to-book affects your visibility and acceptance rate.',
        ],
      },
      { type: 'heading', text: 'Common first-week questions' },
      {
        type: 'faq',
        items: [
          { q: 'How long until my listing goes live?', a: 'Hostiva admins review every new listing within 24-48 hours. You\'ll see your status change from "Pending Approval" to "Active" in your Host Dashboard, and a confirmation message will arrive in Messages.' },
          { q: 'When am I officially a host?', a: 'The moment your first listing is approved. A database trigger automatically promotes your account from guest to host, unlocks the Host Dashboard, and adds the Travelling/Hosting toggle to your header.' },
          { q: 'Why can\'t I see the marketplace anymore?', a: 'You\'re in Hostiva Mode (host view). Toggle "Travelling" in the header to browse listings as a guest. You can switch back to "Hosting" at any time.' },
          { q: 'What\'s a fair starting price?', a: 'Search 5-10 similar properties in your city on Hostiva and Airbnb, take the median nightly rate, then start 10-15% lower for your first month to build reviews. Once you have 5 reviews, raise to market rate.' },
        ],
      },
      { type: 'callout', tone: 'success', title: 'Before you post', text: 'Search the forum first — there\'s a strong chance your question has already been answered. If not, include your city, property type, and how long you\'ve been listed so others can give you a relevant answer.' },
    ],
    cta: { label: 'Open the forum', to: '/host/community' },
  },

  'forum-pricing-revenue': {
    slug: 'forum-pricing-revenue',
    title: 'Pricing & revenue',
    subtitle: 'Strategies for seasonal pricing, occupancy optimization, and dynamic pricing tools.',
    icon: TrendingUp,
    category: 'Community Forum',
    sections: [
      { type: 'paragraph', text: 'This is the busiest category on the forum. Hosts share booking data, occupancy spreadsheets, and the exact pricing tweaks that moved their revenue. Hostiva\'s built-in calendar supports per-night custom rates and weekend pricing (Fri-Sun), and most threads here focus on how to use those tools effectively.' },
      { type: 'heading', text: 'Strategies hosts discuss most' },
      {
        type: 'cards',
        items: [
          { title: 'Seasonal multipliers', desc: 'High-season +30-60%, shoulder season at base rate, low season -15-25%. Hostiva\'s Calendar lets you bulk-edit a date range in one click.' },
          { title: 'Weekend bumps', desc: 'Most listings see Fri-Sun price 15-25% above weekdays. The Calendar has a one-click "Weekend Pricing" toggle.' },
          { title: 'Last-minute discounts', desc: 'Drop unsold nights 10-20% inside a 7-day window to fill gaps. Threads here share when discounting hurts long-term price perception.' },
          { title: 'Length-of-stay discounts', desc: 'Weekly (-10%) and monthly (-25%) discounts attract remote workers and snowbirds. Hostiva will support automatic LOS discounts in a future release.' },
          { title: 'Cleaning fee transparency', desc: 'Hosts debate splitting cleaning into the nightly rate vs charging it separately. Splitting wins for 1-2 night stays; separate wins for 5+ nights.' },
          { title: 'Service fee absorption', desc: 'You can pass the platform service fee to guests, absorb it, or split 50/50 in your listing settings. Threads here weigh up conversion vs margin.' },
        ],
      },
      { type: 'heading', text: 'Useful threads to bookmark' },
      {
        type: 'list',
        items: [
          '"My 90-day pricing experiment" — a structured A/B test format hosts re-use.',
          '"Reading the Earnings dashboard" — how to spot underpriced and overpriced months at a glance.',
          '"When to raise prices after a streak of 5-stars" — the consensus is: every 5 reviews, +5%.',
          '"Dynamic pricing tools (PriceLabs, Beyond, Wheelhouse)" — pros, cons, and Hostiva compatibility.',
        ],
      },
      { type: 'callout', tone: 'info', title: 'Track every change', text: 'Always note the date you change a price and the result over the next 14 days. The Financial Books module records every booking and payout — pair it with your pricing notes to learn what actually moves revenue.' },
    ],
    cta: { label: 'Read the full pricing guide', to: '/info/host-pricing' },
  },

  'forum-guest-communication': {
    slug: 'forum-guest-communication',
    title: 'Guest communication',
    subtitle: 'Templates, scripts, and approaches that have worked for top-rated hosts.',
    icon: MessageSquareText,
    category: 'Community Forum',
    sections: [
      { type: 'paragraph', text: 'Communication is the single biggest driver of a 5-star review. This category is where hosts share the exact wording of their booking confirmations, check-in instructions, and how they handle complaints. Every thread is real-world tested.' },
      { type: 'heading', text: 'The 5 messages every host should automate' },
      {
        type: 'cards',
        items: [
          { title: '1. Booking confirmation (within 1 hour)', desc: 'Thank the guest, confirm dates and total, and tell them check-in details will arrive 48 hours before arrival.' },
          { title: '2. Pre-arrival (48h before)', desc: 'Address, check-in time, parking, Wi-Fi name, door code, and how to reach you. Most no-show issues come from this message being missing.' },
          { title: '3. Day-of welcome (1h after check-in)', desc: '"You\'re in! Anything I can help with?" — opens the door for small fixes before they become 4-star complaints.' },
          { title: '4. Mid-stay check-in (stays 4+ nights)', desc: 'A short, friendly message on day 2 or 3. Top hosts say this single touchpoint adds 0.3 stars on average.' },
          { title: '5. Pre-checkout (night before)', desc: 'Checkout time, where to leave keys, dishwasher/trash instructions, and a soft ask for a review.' },
        ],
      },
      { type: 'heading', text: 'Built into Hostiva Messages' },
      {
        type: 'list',
        items: [
          'Quick replies — save up to 20 templates and insert them with one click.',
          'Scheduled sends — write the pre-arrival message the moment you confirm the booking and schedule it to send 48h before check-in.',
          'Typing indicators and read receipts so guests know you\'ve seen their message.',
          'Real-time delivery via Supabase Realtime — no refresh needed.',
        ],
      },
      { type: 'heading', text: 'Handling difficult conversations' },
      { type: 'paragraph', text: 'The forum has hundreds of threads on de-escalation. The pattern that works: acknowledge first ("I hear you, that\'s frustrating"), restate the issue in your own words, offer one concrete fix, and keep the entire exchange inside Hostiva Messages so support has a record if it escalates.' },
      { type: 'callout', tone: 'warn', title: 'Never share contact details outside Hostiva', text: 'Conversations stay encrypted inside the platform for trust & safety. If something goes wrong, our team can only help if the conversation is on the record.' },
    ],
    cta: { label: 'Open Messages', to: '/messages' },
  },

  'forum-local-regulations': {
    slug: 'forum-local-regulations',
    title: 'Local regulations',
    subtitle: 'City-by-city threads on permits, taxes, short-term rental rules, and HOA policies.',
    icon: ShieldCheck,
    category: 'Community Forum',
    sections: [
      { type: 'paragraph', text: 'Short-term rental laws change fast. This is the most actively-moderated category on the forum because misinformation can cost you fines or a delisting. Threads are organized by city, and Hostiva moderators flag outdated information when laws change.' },
      { type: 'heading', text: 'What to research before listing' },
      {
        type: 'list',
        items: [
          'Permit or registration number — many cities (NYC, Paris, Barcelona, Amsterdam, Lisbon) require one before you can list.',
          'Maximum number of rental nights per year — Amsterdam caps at 30 nights, London at 90, Paris at 120.',
          'Occupancy or tourist tax — your city may require you to collect and remit a percentage on top of your nightly rate.',
          'Whether your home is a primary or secondary residence — many cities only allow short-term rentals in primary residences.',
          'Lease, condo, HOA, or co-op rules — your building may forbid short-term rentals even if your city allows them.',
          'Insurance — confirm your homeowner or renter policy covers paid short-term guests, or buy a dedicated STR policy.',
        ],
      },
      { type: 'heading', text: 'How threads are organized' },
      {
        type: 'cards',
        items: [
          { title: 'City megathreads', desc: 'One pinned thread per city (e.g. "Lisbon STR rules — 2025") with a community-maintained summary at the top.' },
          { title: 'Tax & accounting', desc: 'How to track occupancy tax in the Financial Books module and what to hand to your accountant at year-end.' },
          { title: 'HOA & lease disputes', desc: 'Hosts share template letters they\'ve used to negotiate with building managers and HOAs.' },
          { title: 'Enforcement updates', desc: 'When a city steps up enforcement, hosts post fines, takedown notices, and what worked to resolve them.' },
        ],
      },
      { type: 'callout', tone: 'warn', title: 'Hostiva cannot give legal advice', text: 'Forum posts are written by hosts, not lawyers. Always confirm rules with your local government, a licensed accountant, and your insurance broker before listing. The Responsible Hosting guide has a starter checklist.' },
    ],
    cta: { label: 'Read Responsible Hosting', to: '/info/responsible-hosting' },
  },

  'forum-property-setup': {
    slug: 'forum-property-setup',
    title: 'Property setup',
    subtitle: 'Furnishing on a budget, must-have amenities, and small touches that earn 5-star reviews.',
    icon: HomeIcon,
    category: 'Community Forum',
    sections: [
      { type: 'paragraph', text: 'A great listing starts before the first photo. This category is where hosts share furniture sources, the amenities that actually move bookings, and the small details that turn a 4.6 review into a 5.0.' },
      { type: 'heading', text: 'The amenities guests filter for most' },
      {
        type: 'list',
        items: [
          'Wi-Fi (required — list the speed in Mbps in your description).',
          'Free parking on premises.',
          'Air conditioning and/or heating.',
          'Kitchen with cookware, basic spices, coffee maker, and a kettle.',
          'Washer and dryer (huge for stays of 4+ nights).',
          'Dedicated workspace — a real desk and chair, not a kitchen counter.',
          'Self check-in (smart lock or lockbox) — reduces guest friction and 5-star check-in scores.',
        ],
      },
      { type: 'heading', text: 'Furnishing on a budget' },
      {
        type: 'cards',
        items: [
          { title: 'Beds & mattresses', desc: 'Spend here. A medium-firm queen or king mattress + a mattress protector + 2 pillow options (firm and soft) per guest is the community consensus.' },
          { title: 'Linens', desc: 'White only — easier to bleach, easier to spot stains, looks hotel-grade in photos. Buy 2 full sets per bed so one is always in the wash.' },
          { title: 'Kitchen', desc: 'A basic 12-piece set, 1 sharp chef\'s knife, 1 non-stick pan, salt/pepper/oil/coffee/tea/sugar. Forum users rate this list as the minimum that prevents complaints.' },
          { title: 'Bathroom', desc: 'Shampoo, conditioner, body wash, and lotion in refillable dispensers. Two towels per guest plus a hand towel and bath mat.' },
          { title: 'The "wow" extras', desc: 'Welcome card, local snacks, a printed neighborhood guide, fresh flowers, a dimmable bedside lamp. These three to five small things are what review threads credit for 5-stars.' },
        ],
      },
      { type: 'callout', tone: 'info', title: 'Photograph it the day you finish', text: 'Shoot photos the moment your setup is complete and before any wear. Schedule a pro photographer for the same week. The Photography that Converts guide has a 12-shot checklist.' },
    ],
    cta: { label: 'Read the photography checklist', to: '/info/host-photography' },
  },

  'forum-tech-integrations': {
    slug: 'forum-tech-integrations',
    title: 'Tech & integrations',
    subtitle: 'iCal sync, smart locks, dynamic pricing tools, and cleaning service software.',
    icon: CalendarDays,
    category: 'Community Forum',
    sections: [
      { type: 'paragraph', text: 'Hostiva is built to work alongside the tools you already use. This category is where hosts share which integrations save hours every week, the gotchas, and the setups that quietly cause double bookings if you\'re not careful.' },
      { type: 'heading', text: 'Calendar sync (iCal)' },
      { type: 'paragraph', text: 'Every Hostiva listing exposes an iCal feed and accepts external iCal URLs. Hostiva polls imported calendars every 2 hours, so a booking made on Airbnb appears as a blocked night on Hostiva within 2 hours — and vice versa. The Calendar & iCal Sync guide walks through the setup with Airbnb, Booking.com, and Vrbo.' },
      { type: 'heading', text: 'Smart locks' },
      {
        type: 'cards',
        items: [
          { title: 'August / Yale / Schlage Encode', desc: 'Generate a unique guest code per booking, valid only between check-in and checkout. Store the code in the booking notes so it appears in your pre-arrival message.' },
          { title: 'Igloohome', desc: 'Works offline — no Wi-Fi required at the property. Popular for cabins and remote stays.' },
          { title: 'TTLock', desc: 'Budget-friendly with a generous free app tier. Good for hosts with 1-3 listings.' },
        ],
      },
      { type: 'heading', text: 'Dynamic pricing' },
      {
        type: 'list',
        items: [
          'PriceLabs, Beyond, and Wheelhouse pull demand and event data and write back nightly rates.',
          'Hosts report 10-25% revenue lift in the first 90 days.',
          'Watch for collisions: if your tool overrides your weekend pricing, disable Hostiva\'s weekend toggle to avoid surprises.',
        ],
      },
      { type: 'heading', text: 'Operations & cleaning' },
      {
        type: 'list',
        items: [
          'Turno (formerly TurnoverBnB) and Properly auto-assign cleanings the moment a checkout is confirmed.',
          'Breezeway handles cleaning, inspections, and maintenance checklists with photo proof.',
          'Most hosts pay cleaners directly and log the expense in the Financial Books module so it shows up in monthly P&L.',
        ],
      },
      { type: 'callout', tone: 'info', title: 'Test every integration before guests arrive', text: 'After connecting a new tool, run a fake booking on the next free weekend. Confirm the dates block on Hostiva, the smart lock generates a code, and the cleaner gets the assignment. Catching a misconfiguration on a test is free; catching it on a real booking is a 1-star review.' },
    ],
    cta: { label: 'Read the Calendar & iCal sync guide', to: '/info/host-calendar-sync' },
  },
};

const toneClasses = {
  info: 'border-primary/30 bg-primary/5 text-foreground',
  warn: 'border-destructive/30 bg-destructive/5 text-foreground',
  success: 'border-green-500/30 bg-green-500/5 text-foreground',
};

const toneIcon = {
  info: AlertCircle,
  warn: AlertCircle,
  success: CheckCircle2,
};

export default function Info() {
  const { slug } = useParams<{ slug: string }>();
  const data = slug ? PAGES[slug] : undefined;

  if (!data) return <Navigate to="/" replace />;

  const Icon = data.icon;
  const canonical = `https://host-iva.com/info/${data.slug}`;

  // FAQ structured data when the page contains a FAQ section
  const faqSection = data.sections.find((s) => s.type === 'faq') as { type: 'faq'; items: { q: string; a: string }[] } | undefined;
  const faqJsonLd = faqSection ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqSection.items.map((it) => ({
      '@type': 'Question',
      name: it.q,
      acceptedAnswer: { '@type': 'Answer', text: it.a },
    })),
  } : null;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://host-iva.com/' },
      { '@type': 'ListItem', position: 2, name: data.category },
      { '@type': 'ListItem', position: 3, name: data.title, item: canonical },
    ],
  };

  return (
    <Layout>
      <Helmet>
        <title>{`${data.title} — Hostiva ${data.category}`}</title>
        <meta name="description" content={data.subtitle} />
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content={`${data.title} — Hostiva`} />
        <meta property="og:description" content={data.subtitle} />
        <meta property="og:url" content={canonical} />
        <meta property="og:type" content="article" />
        <script type="application/ld+json">{JSON.stringify(breadcrumbJsonLd)}</script>
        {faqJsonLd && <script type="application/ld+json">{JSON.stringify(faqJsonLd)}</script>}
      </Helmet>
      <div className="bg-secondary/30 border-b border-border">
        <div className="container mx-auto px-4 md:px-6 py-12">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
            <Link to="/" className="hover:text-foreground">Home</Link>
            <ChevronRight className="w-4 h-4" />
            <span>{data.category}</span>
            <ChevronRight className="w-4 h-4" />
            <span className="text-foreground font-medium">{data.title}</span>
          </div>
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
              <Icon className="w-7 h-7 text-primary" />
            </div>
            <div className="flex-1">
              <Badge variant="secondary" className="mb-2">{data.category}</Badge>
              <h1 className="font-display text-3xl md:text-4xl font-extrabold text-foreground">{data.title}</h1>
              <p className="text-muted-foreground mt-2 text-lg max-w-2xl">{data.subtitle}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-6 py-12 max-w-4xl">
        <div className="space-y-8">
          {data.sections.map((section, idx) => {
            switch (section.type) {
              case 'heading':
                return (
                  <h2 key={idx} className="font-display text-2xl font-bold text-foreground pt-4">
                    {section.text}
                  </h2>
                );
              case 'paragraph':
                return (
                  <p key={idx} className="text-muted-foreground leading-relaxed text-base">
                    {section.text}
                  </p>
                );
              case 'list':
                return (
                  <ul key={idx} className="space-y-2.5">
                    {section.items.map((item, i) => (
                      <li key={i} className="flex items-start gap-3 text-muted-foreground">
                        <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                        <span className="leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                );
              case 'cards':
                return (
                  <div key={idx} className="grid md:grid-cols-2 gap-4">
                    {section.items.map((item, i) => {
                      const inner = (
                        <CardContent className="p-5">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="font-semibold text-foreground mb-2">{item.title}</h3>
                            {item.to && <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1 group-hover:text-primary transition-colors" />}
                          </div>
                          <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                        </CardContent>
                      );
                      const cardClass = "border-border hover:border-primary/40 hover:shadow-md transition-all h-full";
                      return item.to ? (
                        <Link key={i} to={item.to} className="group block">
                          <Card className={cardClass}>{inner}</Card>
                        </Link>
                      ) : (
                        <Card key={i} className={cardClass}>{inner}</Card>
                      );
                    })}
                  </div>
                );
              case 'callout': {
                const ToneIcon = toneIcon[section.tone];
                return (
                  <div key={idx} className={`rounded-xl border-2 p-5 flex items-start gap-3 ${toneClasses[section.tone]}`}>
                    <ToneIcon className="w-5 h-5 shrink-0 mt-0.5 text-primary" />
                    <div>
                      <p className="font-semibold mb-1">{section.title}</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">{section.text}</p>
                    </div>
                  </div>
                );
              }
              case 'faq':
                return (
                  <Accordion key={idx} type="single" collapsible className="bg-card border border-border rounded-xl overflow-hidden">
                    {section.items.map((item, i) => (
                      <AccordionItem key={i} value={`item-${i}`} className="border-border last:border-0">
                        <AccordionTrigger className="px-5 text-left hover:no-underline font-medium">
                          {item.q}
                        </AccordionTrigger>
                        <AccordionContent className="px-5 text-muted-foreground leading-relaxed">
                          {item.a}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                );
              default:
                return null;
            }
          })}

          {data.cta && (
            <div className="pt-6 border-t border-border flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <p className="text-muted-foreground flex-1">Ready to take the next step?</p>
              <Button asChild size="lg" className="rounded-full">
                <Link to={data.cta.to}>
                  {data.cta.label}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </div>
          )}

          {/* ===== Related Host Guides (auto-generated for host-* sub-pages) ===== */}
          {(() => {
            const HOST_GUIDES: Array<{ slug: string; title: string; desc: string }> = [
              { slug: 'host-pricing',         title: 'Pricing your listing',         desc: 'Seasonal pricing, weekend rates, and last-minute discounts.' },
              { slug: 'host-photography',     title: 'Photography that converts',    desc: 'A 12-photo checklist and lighting tips guests scroll for.' },
              { slug: 'host-description',     title: 'Writing a winning description',desc: 'Opening line, amenities list, and neighborhood paragraph.' },
              { slug: 'host-calendar-sync',   title: 'Calendar & iCal sync',         desc: 'Connect Airbnb, Booking.com, and Vrbo to prevent double bookings.' },
              { slug: 'host-reviews',         title: 'Handling reviews',             desc: 'How the dual-blind review system works and how to respond.' },
              { slug: 'host-tax-accounting',  title: 'Tax & accounting',             desc: 'Track every payout, expense, and deductible — exportable to CSV.' },
            ];
            const isHostGuide = HOST_GUIDES.some((g) => g.slug === data.slug);
            if (!isHostGuide) return null;
            const others = HOST_GUIDES.filter((g) => g.slug !== data.slug);
            return (
              <div className="pt-8 border-t border-border">
                <h2 className="font-display text-2xl font-bold text-foreground mb-4 flex items-center gap-2">
                  <BookOpen className="w-6 h-6 text-primary" />
                  Related guides
                </h2>
                <p className="text-muted-foreground mb-6">Keep building your hosting toolkit — here are the other 5 essential guides every Hostiva host should read.</p>
                <div className="grid md:grid-cols-2 gap-4">
                  {others.map((g) => (
                    <Link key={g.slug} to={`/info/${g.slug}`} className="group block">
                      <Card className="border-border hover:border-primary/40 hover:shadow-md transition-all h-full">
                        <CardContent className="p-5">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">{g.title}</h3>
                            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1 group-hover:text-primary transition-colors" />
                          </div>
                          <p className="text-sm text-muted-foreground leading-relaxed">{g.desc}</p>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })()}

          <div className="pt-8 border-t border-border flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <Mail className="w-4 h-4" /> support@hostly.co.ke
            </span>
            <span className="flex items-center gap-2">
              <Phone className="w-4 h-4" /> +1 872 221 7881
            </span>
            <span className="flex items-center gap-2">
              <Users className="w-4 h-4" /> Available 24/7
            </span>
          </div>
        </div>
      </div>
    </Layout>
  );
}