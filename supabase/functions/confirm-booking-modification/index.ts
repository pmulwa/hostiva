// Verifies the Paystack transaction for a guest-initiated booking
// modification, then atomically applies the proposed `pending_modification`
// dates to the booking row. Idempotent — safe to invoke repeatedly from the
// success page (push) or polling (pull).
// Replaces the previous Stripe modification confirmation flow.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function verifyPaystackTransaction(
  reference: string,
  secretKey: string,
): Promise<{ paid: boolean; bookingId: string | null; isModification: boolean }> {
  const res = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${secretKey}` } },
  );
  const data = await res.json();
  if (!data.status || !data.data) return { paid: false, bookingId: null, isModification: false };
  const tx = data.data;
  return {
    paid: tx.status === "success",
    bookingId: tx.metadata?.booking_id ?? null,
    isModification: tx.metadata?.modification === "true",
  };
}

async function refundPaystackTransaction(reference: string, secretKey: string): Promise<void> {
  try {
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
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
    console.error("[confirm-booking-modification] refund failed", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { bookingId, reference } = await req.json();
    if (!bookingId || !/^[0-9a-f-]{36}$/i.test(bookingId)) {
      return json({ error: "invalid bookingId" }, 400);
    }

    const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: booking, error: bErr } = await admin
      .from("bookings")
      .select(
        "id, status, host_id, guest_id, property_id, check_in_date, check_out_date, total_price, num_nights, currency, pending_modification, modification_payment_session_id, properties(title)",
      )
      .eq("id", bookingId)
      .maybeSingle();
    if (bErr || !booking) return json({ error: "Booking not found" }, 404);

    const pending = (booking as any).pending_modification;
    if (!pending) {
      return json({ status: "no_pending_modification", applied: false });
    }

    // Verify Paystack payment for this modification
    const resolvedRef = reference || (booking as any).modification_payment_session_id;
    let paid = false;

    if (resolvedRef) {
      try {
        const result = await verifyPaystackTransaction(resolvedRef, paystackSecretKey);
        if (result.paid && result.bookingId === bookingId && result.isModification) {
          paid = true;
        }
      } catch (e) {
        console.warn("[confirm-booking-modification] verify failed", e);
      }
    }

    if (!paid) return json({ status: "awaiting_payment", applied: false });

    // Re-validate that the new dates STILL don't overlap (race condition guard)
    const { data: overlap } = await admin
      .from("bookings")
      .select("id")
      .eq("property_id", booking.property_id)
      .neq("id", bookingId)
      .in("status", ["confirmed", "pending", "pending_host_approval", "in_progress"])
      .lt("check_in_date", pending.new_check_out_date)
      .gt("check_out_date", pending.new_check_in_date)
      .limit(1);

    if (overlap && overlap.length > 0) {
      // Conflict — refund the modification charge and clear the staging row
      if (resolvedRef) {
        await refundPaystackTransaction(resolvedRef, paystackSecretKey);
      }
      await admin
        .from("bookings")
        .update({ pending_modification: null, modification_payment_session_id: null })
        .eq("id", bookingId);
      return json({
        status: "conflict_refunded",
        applied: false,
        message: "Those dates were just taken — your modification charge has been refunded.",
      });
    }

    // Apply the new dates atomically
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
      console.error("[confirm-booking-modification] update failed", updErr);
      return json({ error: updErr.message }, 500);
    }

    // Post system message in the booking thread
    const { data: ps } = await admin
      .from("platform_settings")
      .select("booking_id_prefix, booking_id_length")
      .maybeSingle();
    const prefix = (ps?.booking_id_prefix as string | null) || "BK";
    const length = Math.min(
      32,
      Math.max(8, Number.isFinite(ps?.booking_id_length) ? Number(ps?.booking_id_length) : 8),
    );
    const fullCode = `${prefix}-${bookingId.replace(/-/g, "").slice(0, length).toUpperCase()}`;
    const msg =
      `🗓️ Booking ${fullCode} dates were modified by the guest and the price difference has been paid. ` +
      `New stay: ${pending.new_check_in_date} (check-in) to ${pending.new_check_out_date} (check-out) — ` +
      `${pending.new_num_nights} night${pending.new_num_nights > 1 ? "s" : ""}.`;

    await admin.from("messages").insert({
      sender_id: booking.guest_id,
      receiver_id: booking.host_id,
      booking_id: bookingId,
      content: msg,
      message_type: "system",
    });

    return json({
      status: "applied",
      applied: true,
      newCheckIn: pending.new_check_in_date,
      newCheckOut: pending.new_check_out_date,
    });
  } catch (err) {
    console.error("[confirm-booking-modification]", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}