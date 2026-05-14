// Initiates a Paystack payment for a booking.
// Replaces the previous Stripe Checkout session flow.
// Paystack handles multi-currency (KES, NGN, GHS, ZAR, USD etc.) and
// supports M-Pesa, Visa, Mastercard, and bank transfers in one integration.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Paystack requires amounts in the smallest currency unit (kobo, pesewas, cents).
// Multiply by 100 across all supported currencies.
function toPaystackAmount(amount: number): number {
  return Math.round(amount * 100);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  );

  try {
    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user?.email) throw new Error("User not authenticated");

    const {
      bookingId,
      propertyTitle,
      totalPrice,
      currency,
      numNights,
      checkIn,
      checkOut,
    } = await req.json();

    if (!bookingId || !totalPrice || !propertyTitle) {
      return json({ error: "Missing required fields: bookingId, totalPrice, propertyTitle" }, 400);
    }

    const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!paystackSecretKey) {
      throw new Error("PAYSTACK_SECRET_KEY is not configured");
    }

    const origin = req.headers.get("origin") ?? "";

    // Determine currency — platform default is USD, Paystack converts to
    // local currency at checkout based on customer's payment method.
    // Kenya Paystack accounts only support KES. Swap to USD when multi-currency is enabled on your live account.
    const paystackCurrency = "KES";

    // Unique idempotency reference — bucketed per booking per minute so
    // rapid double-clicks reuse the same transaction rather than creating
    // duplicates. After 1 minute a new reference is allowed (genuine retry).
    const minuteBucket = Math.floor(Date.now() / 60_000);
    const reference = `hostiva-bk-${bookingId.replace(/-/g, "").slice(0, 12)}-${minuteBucket}`;

    const paystackPayload = {
      email: user.email,
      amount: toPaystackAmount(totalPrice),
      currency: paystackCurrency,
      reference,
      callback_url: `${origin}/booking-confirmation/${bookingId}?payment=success&reference=${reference}`,
      metadata: {
        booking_id: bookingId,
        user_id: user.id,
        property_title: propertyTitle,
        num_nights: numNights,
        check_in: checkIn,
        check_out: checkOut,
      },
      // Enable all payment channels — Paystack shows M-Pesa, cards, bank transfer
      // based on the customer's country automatically.
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
      console.error("[create-booking-checkout] Paystack error:", paystackData);
      throw new Error(paystackData.message || "Paystack failed to initialize transaction");
    }

    // Store the Paystack reference on the booking row so confirm-booking-payment
    // can verify server-side without relying solely on the URL parameter.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    await admin
      .from("bookings")
      .update({ payment_reference: reference, status: "pending" })
      .eq("id", bookingId);

    return json({
      url: paystackData.data.authorization_url,
      reference: paystackData.data.reference,
      accessCode: paystackData.data.access_code,
    });
  } catch (error) {
    console.error("[create-booking-checkout] error:", error);
    return json({ error: (error as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}