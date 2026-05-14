// Creates a Paystack transaction that charges the GUEST only the price
// delta needed to extend / move a confirmed booking to new dates.
// Replaces the previous Stripe modification checkout flow.
// The proposed dates have already been written to bookings.pending_modification
// by the client. On payment success, `confirm-booking-modification` applies
// the dates atomically and re-blocks the calendar.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  );

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const { data: u } = await userClient.auth.getUser(token);
    const user = u.user;
    if (!user?.email) throw new Error("Not authenticated");

    const body = await req.json();
    const { bookingId, propertyTitle, deltaAmount, currency, newCheckIn, newCheckOut, newNights } = body ?? {};

    if (!bookingId || !/^[0-9a-f-]{36}$/i.test(bookingId)) {
      return json({ error: "invalid bookingId" }, 400);
    }
    const delta = Number(deltaAmount);
    if (!Number.isFinite(delta) || delta <= 0) {
      return json({ error: "deltaAmount must be > 0" }, 400);
    }

    const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!paystackSecretKey) {
      throw new Error("PAYSTACK_SECRET_KEY is not configured");
    }

    const origin = req.headers.get("origin") ?? "";
    const paystackCurrency = (currency || "USD").toUpperCase();

    // Idempotency reference — bucketed per booking per minute
    const minuteBucket = Math.floor(Date.now() / 60_000);
    const reference = `hostiva-mod-${bookingId.replace(/-/g, "").slice(0, 12)}-${minuteBucket}`;

    const paystackPayload = {
      email: user.email,
      amount: Math.round(delta * 100),
      currency: paystackCurrency,
      reference,
      callback_url: `${origin}/booking-confirmation/${bookingId}?modification=success&reference=${reference}`,
      metadata: {
        booking_id: bookingId,
        user_id: user.id,
        modification: "true",
        new_check_in: newCheckIn,
        new_check_out: newCheckOut,
        property_title: propertyTitle ?? "Stay",
        new_nights: newNights,
      },
      channels: ["card", "mobile_money", "bank_transfer", "ussd", "bank"],
    };

    const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paystackPayload),
    });

    const paystackData = await paystackRes.json();

    if (!paystackData.status || !paystackData.data?.authorization_url) {
      console.error("[create-booking-modification-checkout] Paystack error:", paystackData);
      throw new Error(paystackData.message || "Paystack failed to initialize transaction");
    }

    // Persist reference so confirm-booking-modification can verify later
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    await admin
      .from("bookings")
      .update({ modification_payment_session_id: reference })
      .eq("id", bookingId)
      .eq("guest_id", user.id);

    return json({
      url: paystackData.data.authorization_url,
      reference: paystackData.data.reference,
      accessCode: paystackData.data.access_code,
    });
  } catch (err) {
    console.error("[create-booking-modification-checkout]", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}