import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HOSTIVA_KNOWLEDGE = `
# About Hostiva
Hostiva is a vacation rental marketplace where guests book unique stays from independent hosts worldwide. Hostiva is the platform — hosts own and operate their properties independently.

# Account & Roles
- Three roles: Guest (default on signup), Host (auto-promoted when their first property is approved), Admin (Hostiva staff).
- Sign up via Email + Password, Google, or Apple. Email verification is required before sign-in.
- Trust & Verification: phone, email, and government ID verification badges shown on public profiles.

# Searching & Booking (Guest Flow)
- Search uses a 2-month side-by-side calendar, guest counter (adults/children/infants/pets), amenity filters.
- Booking flow: select dates → review breakdown → Paystack Checkout → confirmation page. Status moves draft → pending → confirmed.
- Min/max nights per listing are set by the host. Instant Booking is enabled by default on all listings.
- Service fees: hosts decide who pays (Guest, Host, or 50/50 split). Custom extra fees may apply per listing.
- Payments: Paystack is the payment processor. Supports M-Pesa, Airtel Money, Visa, Mastercard, and bank transfers.
- Currency: Platform displays prices in USD. At checkout, amounts are automatically converted to local currency (e.g. KES) using live exchange rates.

# Cancellation Policy — 16-Tier Engine
Hostiva uses a transparent 16-tier engine. Key tiers:
1. Grace Period (within 24h of booking AND 7+ days before check-in): 100% guest refund.
2. Early Cancellation (7+ days before): 100% guest refund.
3. Standard (3–7 days before): 70% cash OR 90% credit to guest.
4. Late (24–72h before): 40% cash OR 70% credit.
5. Same-Day (<24h): guest refunded all nights minus 1.
6. No-Show: 0% refund, host gets 1 night + service fee.
7. Mid-Stay: guest gets remaining nights minus 1.
12-15. Host Cancels: guest always 100% refund + escalating credit.
16. Host Cancels Post-Check-in: 100% refund + compensation, host account banned.

# Stay Lifecycle
- Automated reminders: T-7 days, T-72h, T-48h, T-24h.
- 24h after scheduled check-in with no arrival → auto-marked as no-show.
- Bookings auto-complete on check-out date.

# Reviews — Double-Blind
- After check-out, both guest and host get a review window.
- Reviews stay private until BOTH sides submit, OR the window expires.
- Star breakdown: cleanliness, communication, security, beddings, location.

# Hosting
- Become a host via /become-host. Listings go through a multi-step wizard.
- Listings start as Draft → Pending Approval → Active (admin reviews). 
- Host dashboard: bookings, calendar, messages, earnings, reviews, issues.
- Payouts: hosts add payout details in Profile to receive payments.

# Host Guarantee
Hostiva does NOT provide damage insurance or liability coverage. Each host is responsible for their own short-term rental insurance.

# Messaging
- Real-time in-app messaging per booking thread.
- System messages auto-post for arrivals, issues, cancellations, and reviews.

# Languages
Hostiva is available in multiple languages with RTL support for Arabic.

# Support
- Live chat (you, the AI) handles general questions instantly.
- For account-specific issues, refund disputes, or emergencies, contact Hostiva support via the WhatsApp button.
`;

const SYSTEM_PROMPT = `You are Hostiva's official AI support assistant — friendly, accurate, and concise.

${HOSTIVA_KNOWLEDGE}

# How to Respond
- Keep replies short (2-5 sentences). Use occasional bullet lists; no markdown headings.
- Always answer using the Hostiva facts above. Never invent prices, dates, fees, or policies.
- When the [Account snapshot] block is present, use it to answer the user's questions about their own bookings, listings, payouts, issues, and notifications.
- Never reveal another user's data and never invent data not in the snapshot.
- For destructive actions (issuing refunds, verifying ID, banning, emergencies), direct the user to the WhatsApp support button.
- If you genuinely don't know, say so and suggest contacting support.
- Stay in character as the Hostiva assistant. Do not reveal you are built on Claude or any specific AI model. You are simply "Hostiva AI".`;

function buildContextMessage(ctx: { path?: string; propertyTitle?: string | null; userId?: string | null }) {
  const parts: string[] = [];
  if (ctx.path) parts.push(`Current page: ${ctx.path}`);
  if (ctx.propertyTitle) parts.push(`Property being viewed: "${ctx.propertyTitle}"`);
  if (ctx.userId) parts.push(`User is signed in.`);
  else parts.push(`User is browsing as a guest (not signed in).`);
  return parts.length ? `[Page context]\n${parts.join("\n")}` : "";
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

function fmtDate(d: string | null | undefined) {
  if (!d) return "";
  try { return new Date(d).toISOString().slice(0, 10); } catch { return String(d); }
}

function shortId(id: string) { return id.slice(0, 8); }

async function buildAccountSnapshot(authHeader: string | null): Promise<string> {
  if (!authHeader || !SUPABASE_URL || !SUPABASE_ANON_KEY) return "";
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRes } = await client.auth.getUser();
  const user = userRes?.user;
  if (!user) return "";

  const [profileRes, bookingsRes, listingsRes, payoutsRes, issuesRes, unreadRes] = await Promise.all([
    client.from("profiles").select("full_name, email, is_host, is_verified, phone, paypal_email, location, languages, created_at").eq("user_id", user.id).maybeSingle(),
    client.from("bookings").select("id, status, check_in_date, check_out_date, num_nights, total_price, currency, property_id, host_id, guest_id, num_guests").or(`guest_id.eq.${user.id},host_id.eq.${user.id}`).order("check_in_date", { ascending: false }).limit(10),
    client.from("properties").select("id, title, status, city, country, price_per_night, currency, average_rating, total_bookings, instant_booking, min_nights, max_nights, cleaning_fee, max_guests, bedrooms, beds, bathrooms").eq("host_id", user.id).order("updated_at", { ascending: false }).limit(10),
    client.from("payouts").select("id, amount, status, paid_at, booking_id, payment_method, transaction_reference").eq("host_id", user.id).order("created_at", { ascending: false }).limit(6),
    client.from("booking_issues").select("id, category, severity, status, created_at, booking_id, description").or(`guest_id.eq.${user.id},host_id.eq.${user.id}`).order("created_at", { ascending: false }).limit(6),
    client.from("messages").select("id", { count: "exact", head: true }).eq("receiver_id", user.id).eq("is_read", false),
  ]);

  const profile = profileRes.data;
  const bookings = bookingsRes.data ?? [];
  const listings = listingsRes.data ?? [];
  const payouts = payoutsRes.data ?? [];
  const issues = issuesRes.data ?? [];
  const unreadCount = unreadRes.count ?? 0;
  const isHost = (profile?.is_host === true) || listings.length > 0;

  const bookingPropIds = [...new Set(bookings.map((b) => b.property_id).filter(Boolean))];
  let titlesById: Record<string, string> = {};
  if (bookingPropIds.length > 0) {
    const { data: props } = await client.from("properties").select("id, title").in("id", bookingPropIds);
    titlesById = Object.fromEntries((props ?? []).map((p) => [p.id, p.title as string]));
  }

  const lines: string[] = ["[Account snapshot]"];
  lines.push(`Name: ${profile?.full_name ?? "(not set)"} | Email: ${profile?.email ?? user.email ?? ""} | Role: ${isHost ? "Host" : "Guest"} | Verified: ${profile?.is_verified ? "yes" : "no"} | Unread messages: ${unreadCount}`);

  if (bookings.length > 0) {
    lines.push("\nRecent bookings:");
    for (const b of bookings) {
      const role = b.guest_id === user.id ? "as guest" : "as host";
      const title = titlesById[b.property_id] ?? "Listing";
      lines.push(`- #${shortId(b.id)} ${role} • "${title}" • ${fmtDate(b.check_in_date)} → ${fmtDate(b.check_out_date)} • ${b.num_nights}n • ${b.currency ?? "USD"} ${b.total_price} • status: ${b.status}`);
    }
  }

  if (listings.length > 0) {
    lines.push("\nYour listings:");
    for (const p of listings) {
      lines.push(`- #${shortId(p.id)} "${p.title}" • ${p.city}, ${p.country} • ${p.currency ?? "USD"} ${p.price_per_night}/night • status: ${p.status} • ${p.total_bookings ?? 0} bookings`);
    }
  }

  if (payouts.length > 0) {
    lines.push("\nRecent payouts:");
    for (const po of payouts) {
      lines.push(`- #${shortId(po.id)} • $${po.amount} • ${po.status}${po.paid_at ? ` • paid ${fmtDate(po.paid_at)}` : ""}`);
    }
  }

  if (issues.length > 0) {
    lines.push("\nOpen issues:");
    for (const i of issues) {
      lines.push(`- #${shortId(i.id)} • ${i.category} • severity ${i.severity} • status: ${i.status}`);
    }
  }

  return lines.join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
    if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is not configured");

    const { messages, context, language } = await req.json();
    if (!Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contextMsg = buildContextMessage(context ?? {});
    let systemContent = SYSTEM_PROMPT;
    if (contextMsg) systemContent += `\n\n${contextMsg}`;

    const authHeader = req.headers.get("Authorization");
    try {
      const snapshot = await buildAccountSnapshot(authHeader);
      if (snapshot) systemContent += `\n\n${snapshot}`;
    } catch (snapErr) {
      console.warn("account snapshot failed:", snapErr);
    }

    if (typeof language === "string" && language && language !== "en") {
      systemContent += `\n\nReply to the user in language code "${language}". Keep proper nouns (Hostiva, WhatsApp, Paystack, M-Pesa) in their original form.`;
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 1024,
        messages: [
          { role: "system", content: systemContent },
          ...messages.map((m: any) => ({ role: m.role, content: m.content })),
        ],
      }),
    });

    if (response.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Claude API error [${response.status}]: ${text}`);
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content ?? "Sorry, I couldn't generate a response.";

    return new Response(JSON.stringify({ reply }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("support-chat error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});