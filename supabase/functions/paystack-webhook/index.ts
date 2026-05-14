// Paystack Webhook Handler
// Receives server-to-server payment notifications from Paystack.
// This is the most reliable confirmation path — it runs even when the guest
// closes the tab before being redirected back to the site.
//
// Paystack sends a HMAC-SHA512 signature in the `x-paystack-signature` header.
// We verify it against our secret key before processing any event.
//
// Setup: In your Paystack dashboard → Settings → Webhooks
// add your webhook URL: https://<project-ref>.supabase.co/functions/v1/paystack-webhook
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";
import { encode } from "https://deno.land/std@0.190.0/encoding/hex.ts";
import {
  effectiveTemplate,
  renderTemplate,
} from "../_shared/automated-messages.ts";

// Paystack webhooks are public (no JWT) — verified via HMAC signature instead.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-paystack-signature",
};

async function verifyPaystackSignature(
  payload: string,
  signature: string,
  secretKey: string,
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secretKey);
    const messageData = encoder.encode(payload);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"],
    );
    const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
    const computedSignature = new TextDecoder().decode(encode(new Uint8Array(signatureBuffer)));
    return computedSignature === signature;
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
  const payload = await req.text();
  const signature = req.headers.get("x-paystack-signature") ?? "";

  // Always return 200 to Paystack quickly — process async below.
  // Paystack retries on non-200 responses so we must acknowledge receipt first.
  const isValid = await verifyPaystackSignature(payload, signature, paystackSecretKey);
  if (!isValid) {
    console.error("[paystack-webhook] invalid signature — possible spoofed request");
    // Return 200 anyway to prevent Paystack from retrying a genuinely invalid request
    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  // Only handle successful charge events
  if (event.event !== "charge.success") {
    return new Response(JSON.stringify({ received: true, skipped: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  const tx = event.data;
  const metadata = tx?.metadata ?? {};
  const bookingId = metadata.booking_id;
  const isModification = metadata.modification === "true";
  const reference = tx?.reference;

  if (!bookingId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) {
    console.warn("[paystack-webhook] missing or invalid booking_id in metadata", { reference });
    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  if (isModification) {
    // Handle booking modification payment
    await handleModificationPayment(admin, bookingId, reference);
  } else {
    // Handle initial booking payment
    await handleBookingPayment(admin, bookingId, reference, paystackSecretKey);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
});

async function handleBookingPayment(
  admin: any,
  bookingId: string,
  reference: string,
  paystackSecretKey: string,
) {
  const { data: booking, error: bErr } = await admin
    .from("bookings")
    .select(
      "id, status, host_id, guest_id, total_price, check_in_date, check_out_date, num_guests, property_id, properties(instant_booking, title)",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (bErr || !booking) {
    console.error("[paystack-webhook] booking not found", { bookingId });
    return;
  }
  if (booking.status !== "pending") {
    console.log("[paystack-webhook] booking already processed", { bookingId, status: booking.status });
    return;
  }

  // Overlap guard
  const { data: overlapping } = await admin
    .from("bookings")
    .select("id")
    .eq("property_id", booking.property_id)
    .neq("id", bookingId)
    .in("status", ["confirmed", "pending_host_approval", "in_progress"])
    .lt("check_in_date", booking.check_out_date)
    .gt("check_out_date", booking.check_in_date)
    .limit(1);

  if (overlapping && overlapping.length > 0) {
    // Refund and cancel
    try {
      const verifyRes = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        { headers: { Authorization: `Bearer ${paystackSecretKey}` } },
      );
      const verifyData = await verifyRes.json();
      const transactionId = verifyData?.data?.id;
      if (transactionId) {
        await fetch("https://api.paystack.co/refund", {
          method: "POST",
          headers: { Authorization: `Bearer ${paystackSecretKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ transaction: transactionId }),
        });
      }
    } catch (e) {
      console.error("[paystack-webhook] refund failed", e);
    }
    await admin.from("bookings").update({
      status: "cancelled",
      cancellation_reason: "Dates already booked by another guest — payment refunded automatically.",
      refund_status: "refunded",
      refund_amount: booking.total_price,
      refund_date: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", bookingId).eq("status", "pending");
    return;
  }

  // All bookings confirm instantly on payment — no host approval required.
  const targetStatus = "confirmed";
  const approvalDeadline = null;

  const { data: updated } = await admin
    .from("bookings")
    .update({
      status: targetStatus,
      host_approval_deadline: approvalDeadline,
      payment_reference: reference,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId)
    .eq("status", "pending")
    .select("id, status")
    .maybeSingle();

  if (!updated) {
    console.log("[paystack-webhook] booking already transitioned by another path", { bookingId });
    return;
  }

  // Post confirmation message
  const { data: property } = await admin
    .from("properties")
    .select("title")
    .eq("id", booking.property_id)
    .maybeSingle();

  const { data: ps } = await admin
    .from("platform_settings")
    .select("booking_id_prefix, booking_id_length, auto_message_templates")
    .maybeSingle();
  const prefix = (ps?.booking_id_prefix as string | null) || "BK";
  const length = Math.min(32, Math.max(8, Number.isFinite(ps?.booking_id_length) ? Number(ps?.booking_id_length) : 8));
  const fullCode = `${prefix}-${bookingId.replace(/-/g, "").slice(0, length).toUpperCase()}`;
  const guestCount = `${booking.num_guests} guest${booking.num_guests > 1 ? "s" : ""}`;
  const propertyTitle = property?.title ?? "this property";
  const templateOverrides = (ps?.auto_message_templates as Record<string, string> | null) ?? null;

  const confirmationMessage = renderTemplate(effectiveTemplate("booking_confirmed", templateOverrides), {
    code: fullCode,
    title: propertyTitle,
    check_in: booking.check_in_date,
    check_out: booking.check_out_date,
    guests: guestCount,
  });

  const { data: existingMessage } = await admin
    .from("messages")
    .select("id")
    .is("booking_id", null)
    .eq("sender_id", booking.guest_id)
    .eq("receiver_id", booking.host_id)
    .eq("content", confirmationMessage)
    .maybeSingle();

  if (!existingMessage) {
    await admin.from("messages").insert({
      booking_id: null,
      sender_id: booking.guest_id,
      receiver_id: booking.host_id,
      content: confirmationMessage,
      delivery_status: "sent",
      message_type: "text",
    });
  }

  console.log("[paystack-webhook] booking confirmed via webhook", { bookingId, targetStatus });
}

async function handleModificationPayment(admin: any, bookingId: string, reference: string) {
  const { data: booking } = await admin
    .from("bookings")
    .select("id, guest_id, host_id, property_id, pending_modification")
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking?.pending_modification) return;

  const pending = booking.pending_modification;

  const { error: updErr } = await admin
    .from("bookings")
    .update({
      check_in_date: pending.new_check_in_date,
      check_out_date: pending.new_check_out_date,
      num_nights: pending.new_num_nights,
      subtotal: pending.new_subtotal,
      service_fee: pending.new_service_fee,
      total_price: pending.new_total_price,
      last_modified_at: new Date().toISOString(),
      pending_modification: null,
      modification_payment_session_id: null,
    })
    .eq("id", bookingId);

  if (updErr) {
    console.error("[paystack-webhook] modification update failed", updErr);
    return;
  }

  const { data: ps } = await admin
    .from("platform_settings")
    .select("booking_id_prefix, booking_id_length")
    .maybeSingle();
  const prefix = (ps?.booking_id_prefix as string | null) || "BK";
  const length = Math.min(32, Math.max(8, Number.isFinite(ps?.booking_id_length) ? Number(ps?.booking_id_length) : 8));
  const fullCode = `${prefix}-${bookingId.replace(/-/g, "").slice(0, length).toUpperCase()}`;

  await admin.from("messages").insert({
    sender_id: booking.guest_id,
    receiver_id: booking.host_id,
    booking_id: bookingId,
    content: `🗓️ Booking ${fullCode} dates were modified and the price difference has been paid. New stay: ${pending.new_check_in_date} to ${pending.new_check_out_date} — ${pending.new_num_nights} night${pending.new_num_nights > 1 ? "s" : ""}.`,
    message_type: "system",
  });

  console.log("[paystack-webhook] modification applied via webhook", { bookingId });
}