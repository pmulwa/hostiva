// Verifies a Paystack transaction and marks the matching booking as
// `confirmed` server-side. Idempotent — safe to call repeatedly.
// Replaces the previous Stripe Checkout session verification flow.
//
// Why this exists:
//   Paystack calls our webhook AND the guest is redirected back with ?reference=
//   in the URL. This function is the server-authoritative source of truth:
//   the client invokes it on the success page (push) and also polls it as a
//   fallback (pull) so a closed tab never leaves a booking stuck in 'pending'.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  effectiveTemplate,
  renderTemplate,
} from "../_shared/automated-messages.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Verify a Paystack transaction reference against their API.
async function verifyPaystackTransaction(
  reference: string,
  secretKey: string,
): Promise<{ paid: boolean; bookingId: string | null; amount: number }> {
  const res = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
    },
  );
  const data = await res.json();
  if (!data.status || !data.data) {
    return { paid: false, bookingId: null, amount: 0 };
  }
  const tx = data.data;
  const paid = tx.status === "success";
  const bookingId = tx.metadata?.booking_id ?? null;
  // Paystack returns amount in kobo/cents — convert back to major unit
  const amount = (tx.amount ?? 0) / 100;
  return { paid, bookingId, amount };
}

// Issue a Paystack refund for a successful transaction reference.
async function refundPaystackTransaction(
  reference: string,
  secretKey: string,
): Promise<void> {
  try {
    // First get the transaction to get the ID needed for refund
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: { Authorization: `Bearer ${secretKey}` },
      },
    );
    const verifyData = await verifyRes.json();
    const transactionId = verifyData?.data?.id;
    if (!transactionId) return;

    await fetch("https://api.paystack.co/refund", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transaction: transactionId }),
    });
  } catch (e) {
    console.error("[confirm-booking-payment] refund failed", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookingId, reference } = await req.json();
    if (!bookingId) {
      return json({ error: "bookingId required" }, 400);
    }

    // Basic UUID shape check
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) {
      return json({ error: "invalid bookingId" }, 400);
    }

    const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";

    // Service-role client — bypasses RLS so we can flip status regardless of
    // who is calling. We re-validate via Paystack before touching the row.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // 1) Fast-path idempotency — if the row is already non-pending, short-circuit
    //    BEFORE talking to Paystack. This is the common case for polling/realtime.
    const { data: booking, error: bErr } = await admin
      .from("bookings")
      .select(
        "id, status, host_id, guest_id, total_price, check_in_date, check_out_date, num_guests, num_nights, property_id, payment_reference, properties(instant_booking, title)",
      )
      .eq("id", bookingId)
      .maybeSingle();
    if (bErr || !booking) {
      return json({ error: "Booking not found" }, 404);
    }
    if (booking.status !== "pending" && booking.status !== "draft") {
      return json({
        status: booking.status,
        alreadyProcessed: true,
        paid: booking.status === "confirmed",
      });
    }

    // 2) OVERLAP GUARD — never confirm a booking whose dates overlap with
    //    another already-confirmed booking on the same property.
    const { data: overlapping, error: overlapErr } = await admin
      .from("bookings")
      .select("id, check_in_date, check_out_date, status")
      .eq("property_id", booking.property_id)
      .neq("id", bookingId)
      .in("status", ["confirmed", "pending_host_approval", "in_progress"])
      .lt("check_in_date", booking.check_out_date)
      .gt("check_out_date", booking.check_in_date)
      .limit(1);
    if (overlapErr) {
      console.error("[confirm-booking-payment] overlap check failed", overlapErr);
    } else if (overlapping && overlapping.length > 0) {
      // Race-loser — refund via Paystack and cancel the booking.
      const resolvedRef = reference || (booking as any).payment_reference;
      if (resolvedRef) {
        await refundPaystackTransaction(resolvedRef, paystackSecretKey);
      }
      const { data: cancelled, error: cancelErr } = await admin
        .from("bookings")
        .update({
          status: "cancelled",
          cancellation_reason: "Dates already booked by another guest — payment refunded automatically.",
          refund_status: "refunded",
          refund_amount: booking.total_price,
          refund_date: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", bookingId)
        .eq("status", "pending")
        .select("id, status")
        .maybeSingle();
      if (cancelErr) {
        console.error("[confirm-booking-payment] failed to cancel overlap loser", cancelErr);
      }
      return json({
        status: "cancelled",
        paid: false,
        overlap: true,
        message: "Dates were just booked by another guest. Your payment is being refunded.",
      });
    }

    // 3) Verify payment with Paystack.
    //    Preferred path: use the reference from the callback URL or the stored
    //    payment_reference on the booking row.
    const resolvedRef = reference || (booking as any).payment_reference;
    let paid = false;

    if (resolvedRef) {
      try {
        const result = await verifyPaystackTransaction(resolvedRef, paystackSecretKey);
        // Defence-in-depth: ensure the verified transaction's metadata matches
        // this booking before trusting it.
        if (result.paid && result.bookingId === bookingId) {
          paid = true;
        }
      } catch (e) {
        console.warn("[confirm-booking-payment] Paystack verify failed", e);
      }
    }

    if (!paid) {
      return json({ status: booking.status, paid: false });
    }

    // 4) Confirm — race-safe conditional UPDATE.
    //    The `.eq("status", "pending")` predicate guarantees exactly one
    //    concurrent caller wins the transition; everyone else gets alreadyProcessed.
    //
    //    Instant Book → CONFIRMED immediately.
    //    Request-to-Book → PENDING_HOST_APPROVAL with 24-hour deadline.
    // All bookings confirm instantly on payment — no host approval required.
    const targetStatus = "confirmed";
    const approvalDeadline = null;

    const { data: updated, error: uErr } = await admin
      .from("bookings")
      .update({
        status: targetStatus,
        host_approval_deadline: approvalDeadline,
        updated_at: new Date().toISOString(),
      })
      .eq("id", bookingId)
      .eq("status", "pending")
      .select("id, status")
      .maybeSingle();
    if (uErr) {
      console.error("[confirm-booking-payment] update failed", uErr);
      return json({ error: uErr.message }, 500);
    }

    if (!updated) {
      // Lost the race — re-read and report authoritative status.
      const { data: fresh } = await admin
        .from("bookings")
        .select("status")
        .eq("id", bookingId)
        .maybeSingle();
      return json({
        status: fresh?.status ?? "unknown",
        alreadyProcessed: true,
        paid: fresh?.status === "confirmed",
      });
    }

    // 5) Post booking confirmation message into the existing inquiry thread.
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
    const length = Math.min(
      32,
      Math.max(8, Number.isFinite(ps?.booking_id_length) ? Number(ps?.booking_id_length) : 8),
    );
    const fullCode = `${prefix}-${bookingId.replace(/-/g, "").slice(0, length).toUpperCase()}`;
    const guestCount = `${booking.num_guests} guest${booking.num_guests > 1 ? "s" : ""}`;
    const propertyTitle = property?.title ?? "this property";
    const templateOverrides =
      (ps?.auto_message_templates as Record<string, string> | null) ?? null;

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
      const { error: messageErr } = await admin
        .from("messages")
        .insert({
          booking_id: null,
          sender_id: booking.guest_id,
          receiver_id: booking.host_id,
          content: confirmationMessage,
          delivery_status: "sent",
          message_type: "text",
        });
      if (messageErr) {
        console.error("[confirm-booking-payment] failed to create host message", messageErr);
      }
    }

    // Send email notifications to guest and host
    try {
      await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email-notification`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
          },
          body: JSON.stringify({ type: "booking_confirmed", bookingId: booking.id }),
        }
      );
    } catch (emailErr) {
      console.error("[confirm-booking-payment] email notification failed:", emailErr);
      // Don't fail the booking confirmation if email fails
    }

    return json({ status: targetStatus, paid: true, transitioned: true });
  } catch (err) {
    console.error("[confirm-booking-payment]", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}