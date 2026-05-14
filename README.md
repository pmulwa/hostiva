# Hostiva — Short‑Term Rental Platform

Hostiva is a full‑stack short‑term rental marketplace (Airbnb‑style) built on
**React + Vite + TypeScript + Tailwind + shadcn/ui** with a **Lovable Cloud
(Supabase)** backend. It supports guest discovery and booking, host listing
management, an integrated double‑entry accounting module, dispute & cancellation
handling, real‑time messaging, fraud/trust controls, multi‑currency payouts, and
a comprehensive admin governance suite.

- **Live (published):** https://hostly-homes-unlocked.lovable.app
- **Lovable project:** https://lovable.dev/projects/52449d05-9cc2-4aca-aa55-8e69afd4d891

---

## 1. Tech Stack

| Layer | Tooling |
|-------|---------|
| Frontend framework | React 18 + Vite 5 + TypeScript 5 |
| Styling | Tailwind CSS v3 + shadcn/ui (Radix primitives) |
| State & data | TanStack Query, React Context, Supabase Realtime |
| Forms & validation | React Hook Form + Zod |
| Routing | React Router v6 |
| i18n | i18next (12 languages) |
| Maps | Leaflet + tz-lookup |
| PDF / receipts | jsPDF + qrcode |
| Animation | Framer Motion |
| Money / accounting | decimal.js |
| Backend | Lovable Cloud (Supabase: Postgres, Auth, Storage, Edge Functions, Realtime) |
| Payments | Stripe (checkout + refunds via Edge Functions) |
| Tests | Vitest (unit) + Deno test (edge functions) |

---

## 2. Repository Layout

```
src/
├── components/        # Shared UI + feature components
│   ├── accounting/    # Books, journals, COA, expenses, fixed assets
│   ├── admin/         # Admin shell, sidebar, role gates
│   ├── booking/       # Check-in, issue reporting
│   ├── cancellation/  # Cancellation preview, summary, badges
│   ├── layout/        # Header, footer, layout wrapper
│   ├── property/      # Property cards
│   └── ui/            # shadcn/ui primitives (do not edit blindly)
├── contexts/          # AuthContext
├── hooks/             # Reusable hooks (permissions, payouts, fraud, i18n…)
├── i18n/              # Locale JSON files for 12 languages
├── integrations/
│   └── supabase/      # Auto-generated client + types (DO NOT EDIT)
├── lib/               # Pure logic: cancellation engine, accounting, fraud, dates
├── pages/             # Route-level components
│   ├── admin/         # Admin governance pages
│   └── host/          # Host dashboard, listings, calendar, accounting
└── test/              # Vitest setup + sample tests

supabase/
├── config.toml        # Edge function settings (verify_jwt etc.)
├── functions/         # Deno edge functions
│   ├── confirm-booking-payment/   # Stripe verify + race-safe confirm
│   ├── create-booking-checkout/   # Stripe Checkout session
│   ├── import-listing/            # Scraper for Airbnb/Booking URLs
│   ├── process-stay-lifecycle/    # Cron: mark completed, release payouts
│   └── support-chat/              # AI support assistant
└── migrations/        # SQL migrations (READ ONLY — create new ones, never edit)
```

---

## 3. Core Modules

### 3.1 Authentication & Roles
- Supabase Auth (email/password + Google OAuth + forgot/reset password).
- Roles stored in a dedicated `user_roles` table (never on `profiles`) with a
  `has_role()` SECURITY DEFINER function to avoid RLS recursion.
- Built‑in roles: `admin`, `host`, `guest`, `customer_care`, `finance_officer`,
  `hr`, `moderator`, `operations`, `marketing`. Custom roles + permission sets
  are managed in `custom_roles`.
- Hosts are auto‑promoted via the `on_property_approved` DB trigger.

### 3.2 Listings & Property Management
- Multi‑step host wizard for creating/editing properties with image upload,
  amenity tagging, geolocation pinning (Leaflet + reverse geocoding), and
  timezone auto‑resolution via `tz-lookup`.
- URL import (Airbnb/Booking.com) through the `import-listing` edge function.
- Lifecycle: `draft → pending_approval → active / inactive / rejected`.
- Host fee policy: choose who pays the platform service fee (guest, host, or 50/50).

### 3.3 Search & Booking Flow
- Side‑by‑side 2‑month calendar (collapses to 1 month on mobile).
- Calendar blocking computed in property timezone — booked nights cover
  `check_in_date` through the day **before** `check_out_date` (back‑to‑back
  bookings are allowed).
- Stripe Checkout via `create-booking-checkout`; confirmation handled by
  `confirm-booking-payment` with **race‑condition protection**: only one
  overlapping payment can confirm; the other is auto‑refunded and cancelled.
- Booking statuses: `pending → confirmed → completed` (or `cancelled` / `rejected`).
- Free‑bookings counter for new guests (`useFreeBookingsRemaining`).

### 3.4 Cancellation & Refunds
- Configurable cancellation policy engine in `src/lib/cancellation/engine.ts`
  with deterministic refund calculations (unit‑tested).
- Force‑majeure events table with admin controls to declare regional waivers
  and override host‑compensation percentages.
- Mutual‑review window after cancellation (`MutualReviewForm`).

### 3.5 Reviews
- Dual architecture:
  - **Guest → property** detailed ratings (cleanliness, accuracy, communication, etc.).
  - **Mutual blind reviews** between guest and host with timed publication.
- Aggregations write back to `properties.average_rating` / `total_reviews`.

### 3.6 Messaging
- Real‑time threads via Supabase Realtime on the `messages` table.
- Image/file attachments via Supabase Storage.
- Typing indicators, delivery ticks, and contact‑detail scrubbing
  (`src/lib/contactDetection.ts`) to prevent off‑platform circumvention.
- Anti‑circumvention strikes table with progressive enforcement.
- **Admin Messaging Center** (`/admin/messages`):
  - Join any conversation (messages prefixed with `Admin joined: …`).
  - Broadcast announcements (prefixed with `Broadcast: …`).
  - Mark threads resolved (with internal notes) → tracked in `message_thread_states`.
  - Mute/unmute participants (1h / 24h / 7d / permanent) — enforced server‑side
    by the `enforce_messaging_mute` trigger.

### 3.7 Accounting (Hostiva Books)
- Double‑entry accounting per host with chart of accounts, journal
  entries/lines, expenses, fixed assets + depreciation, opening balances
  wizard, and aging reports.
- Multi‑currency: each transaction stores `txn_currency` + `fx_rate` →
  `base_amount` in the host's `base_currency`.
- Auto‑posts platform bookings into the journal; supports manual entries and
  external (Airbnb/Booking) imports via `acct_import_hostly_bookings`.
- Cash vs. accrual toggle in `acct_settings`.

### 3.8 Payouts
- Tiered payout system (`usePayoutTiers`, `calculate_host_tier` RPC) based on
  rating, completed bookings, response & cancellation rates.
- Holds with SLA tracking (`payout_holds`), installments for long stays
  (`payout_installments`), and host deductions auto‑settled on payout via
  `settle_host_deductions_for_payout`.

### 3.9 Trust, Safety & Fraud
- Fraud risk scoring (`src/lib/fraud/scoring.ts`) writing to `fraud_risk_scores`
  with tiers and recommended actions.
- Sanctions screening (`sanctions_list`, `sanctions_screening_results`).
- Verification badges (email, phone, ID) via `user_verifications`.
- Manual review queue with severity, SLA, and assignment.

### 3.10 Notifications
- Multi‑channel notification log (`notification_log`) with email, push, SMS,
  WhatsApp.
- Per‑user channel overrides, quiet hours, and timezone in
  `notification_preferences_extended`.
- Dispatcher: `src/lib/notifications/dispatcher.ts`.

### 3.11 Admin Suite (`/admin`)
- Dashboard (KPIs), Users (segmented Guests/Hosts/Admins), Properties, Bookings,
  Financials, Host Payments, Payout Tiers, Reviews, Review Queue, Moderation
  Queue, Verifications, Trust & Safety, Force Majeure, Messages, Roles,
  Controls, Settings, Audit Log, Reports, Accounting.
- Permission‑gated via `RequirePermission` + `usePermissions`.

### 3.12 Internationalization
- 12 locales: `en, es, fr, de, it, pt, ru, ar, hi, ja, ko, zh`.
- Add new strings in `src/i18n/locales/<lang>.json` and reference via
  `useTranslation()`.

---

## 4. Database (Supabase / Lovable Cloud)

Generated types live in `src/integrations/supabase/types.ts` (**read‑only,
auto‑generated** — never edit). Highlights:

- Bookings, properties, property_availability, favorites, reviews, mutual_reviews
- Profiles, user_roles, custom_roles, user_verifications, user_preferences
- Messages, messaging_mutes, message_thread_states, anti_circumvention_strikes
- Payouts, payout_holds, payout_installments, host_payout_settings, host_deductions
- Fraud_risk_scores, manual_review_queue, sanctions_list, sanctions_screening_results
- Force_majeure_events, platform_settings, platform_controls, audit_logs
- `acct_*` family for the accounting module (COA, journals, expenses, assets, FX, opening balances, platforms, sharing presets)

All tables use **RLS**. Role checks go through `has_role(auth.uid(), 'role')`.

### Schema changes
- **Always** create a new file in `supabase/migrations/` — never edit existing ones.
- Use validation triggers instead of CHECK constraints for time‑based rules
  (e.g. `expire_at > now()`).
- Never touch `auth`, `storage`, `realtime`, `supabase_functions`, or `vault` schemas.

---

## 5. Edge Functions

| Function | Purpose | `verify_jwt` |
|----------|---------|--------------|
| `create-booking-checkout` | Creates a Stripe Checkout session for a booking | true |
| `confirm-booking-payment` | Verifies Stripe session, atomically confirms booking, refunds losers in race | **false** |
| `process-stay-lifecycle`  | Cron: marks stays completed, releases payouts | **false** |
| `support-chat`            | AI assistant via Lovable AI Gateway | **false** |
| `import-listing`          | Scrapes Airbnb/Booking URLs for listing import | true |

Functions deploy automatically when changed. Per‑function settings live in
`supabase/config.toml`.

---

## 6. Environment

`.env` is auto‑managed by Lovable Cloud and contains:

```
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_PROJECT_ID
```

Server‑side secrets (Stripe keys, AI keys, etc.) are stored via the Lovable
Cloud secrets manager — never commit them.

---

## 7. Local Development

```sh
# 1. Install deps (Node 18+ recommended; use nvm)
npm i

# 2. Start the dev server
npm run dev      # http://localhost:8080

# 3. Other scripts
npm run build         # production build
npm run build:dev     # dev-mode build
npm run lint          # eslint
npm test              # vitest run (unit tests)
npm run test:watch    # vitest in watch mode
```

### Edge function tests (Deno)

```sh
deno test --allow-env --allow-net supabase/functions/confirm-booking-payment/race_test.ts
```

---

## 8. Design System

- Tokens are HSL and live in `src/index.css` + `tailwind.config.ts`.
- **Never** hard‑code colors in components (`text-white`, `bg-black`, etc.).
  Use semantic tokens: `bg-background`, `text-foreground`, `bg-primary`,
  `text-muted-foreground`, etc.
- Add new tokens to both `index.css` (as HSL CSS variables) and
  `tailwind.config.ts` (so Tailwind classes pick them up).
- shadcn components live in `src/components/ui/` — extend them via
  `class-variance-authority` variants rather than forking.

---

## 9. Conventions & Guardrails

- **Read‑only files** (never edit by hand):
  - `src/integrations/supabase/client.ts`
  - `src/integrations/supabase/types.ts`
  - `.env`, `supabase/migrations/*`, lockfiles
- **Roles**: never store on `profiles`. Always use `user_roles` + `has_role()`.
- **Auth**: never use anonymous sign‑ups. Email confirmation is on by default.
- **Money**: use `decimal.js` (`src/lib/accounting/money.ts`) — never raw floats.
- **Dates**: respect property timezone (`src/lib/dates/propertyTz.ts`) when
  computing booked nights or availability.
- **Communication terminology**: refer to the backend as "Lovable Cloud" in
  user‑facing copy (not "Supabase").

---

## 10. Testing Strategy

- **Unit (Vitest)**: cancellation engine, calendar blocking, accounting helpers.
  See `src/lib/**/__tests__/*.test.ts`.
- **Edge functions (Deno)**: race‑condition tests for the payment confirmation
  pipeline ensure overlapping bookings cannot both confirm.
- Run all unit tests with `npm test` before every release.

---

## 11. Deployment

- Open the Lovable project → **Share → Publish**.
- Custom domains: **Project → Settings → Domains → Connect Domain**
  (docs: https://docs.lovable.dev/features/custom-domain).
- Edge functions and migrations deploy automatically on save.

---

## 12. Quick Reference — Where to Look

| I want to… | Open |
|------------|------|
| Tweak colors / typography | `src/index.css`, `tailwind.config.ts` |
| Add a new page | `src/pages/…` + register in `src/App.tsx` |
| Change the booking math | `src/lib/cancellation/`, `confirm-booking-payment/index.ts` |
| Add a translation string | `src/i18n/locales/<lang>.json` |
| Add an admin page | `src/pages/admin/`, sidebar in `src/components/admin/AdminSidebar.tsx` |
| Modify an accounting rule | `src/lib/accounting/` |
| Add a DB column / table | New file in `supabase/migrations/` |
| Add an edge function | New folder in `supabase/functions/` + entry in `supabase/config.toml` if needed |

---

## 13. Support & Docs

- Lovable docs: https://docs.lovable.dev
- Project chat: open the Lovable project URL above and prompt directly — changes
  commit automatically to this repo.
