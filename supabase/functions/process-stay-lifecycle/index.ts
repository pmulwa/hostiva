// Stay Lifecycle Cron — runs every 15 minutes via pg_cron + pg_net.
//
// Sends the time-based half of the platform's three automated messages
// (`stay_lifecycle` in src/lib/automatedMessages.ts):
//
//   1. pre_24h            host → guest, 24-12h before check-in.
//                          Welcome + Google Maps directions link to the pin.
//   2. pre_12h            guest → host, 12-0h before check-in.
//                          Asks the host for access codes / key collection
//                          instructions.
//   3. arrival_nudge      Customer Service → guest, 2-24h after check-in
//                          time when arrival has not yet been confirmed.
//                          Sent as an in-app NOTIFICATION ONLY (never a
//                          message-thread row) so the host can't see it.
//   4. host_no_confirm    Reminder to the GUEST in the booking thread when
//                          24h have passed since check-in time without an
//                          arrival confirmation.
//   5. post_review        1h after check-out — one message to the guest and
//                          one to the host inviting both to leave a review.
//
// Also handles operational housekeeping:
//   • Auto-expiring stale Request-to-Book holds (24h deadline).
//   • Marking no-shows (24h+ after check-in time, still no actual_check_in_at).
//   • Flipping bookings to in_progress / completed.
//   • Auto-publishing mutual reviews whose window has closed.
//
// Idempotent via bookings.last_reminder_sent jsonb map.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import {
  dueReminders,
  effectiveTemplate,
  renderTemplate,
  type ReminderKey as HelperReminderKey,
} from "../_shared/automated-messages.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type ReminderKey =
  | "pre_24h"
  | "pre_12h"
  | "host_no_confirm"
  | "post_review_guest"
  | "post_review_host"
  | "no_show";

interface BookingRow {
  id: string;
  guest_id: string;
  host_id: string;
  property_id: string;
  status: string;
  check_in_date: string;
  check_out_date: string;
  num_guests: number;
  actual_check_in_at: string | null;
  no_show_marked_at: string | null;
  last_reminder_sent: Record<string, string>;
  properties?: {
    title: string;
    check_in_time: string | null;
    check_out_time: string | null;
    latitude: number | null;
    longitude: number | null;
    address: string | null;
    city: string | null;
  } | null;
}

function hoursUntil(target: Date, now: Date): number {
  return (target.getTime() - now.getTime()) / 36e5;
}

function checkInDateTime(b: BookingRow): Date {
  const t = b.properties?.check_in_time || "15:00:00";
  return new Date(`${b.check_in_date}T${t}Z`);
}

function bookingCode(id: string, prefix: string, length: number): string {
  const safe = Math.min(32, Math.max(8, Number.isFinite(length) ? length : 8));
  return `${prefix}-${id.replace(/-/g, "").slice(0, safe).toUpperCase()}`;
}

function mapsLink(b: BookingRow): string {
  const lat = b.properties?.latitude;
  const lng = b.properties?.longitude;
  if (lat != null && lng != null) {
    return `https://www.google.com/maps?q=${lat},${lng}`;
  }
  // Fallback to a search query if the property has no pin.
  const parts = [b.properties?.address, b.properties?.city].filter(Boolean);
  const q = encodeURIComponent(parts.join(", ") || b.properties?.title || "");
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function buildReminderContent(
  key: ReminderKey,
  b: BookingRow,
  code: string,
  overrides: Record<string, string | undefined> | null,
): string {
  const tpl = effectiveTemplate(key, overrides);
  return renderTemplate(tpl, {
    code,
    title: b.properties?.title || "your stay",
    maps: mapsLink(b),
    check_in: b.check_in_date,
    check_out: b.check_out_date,
    guests: `${b.num_guests} guest${b.num_guests > 1 ? "s" : ""}`,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const now = new Date();
  const horizonStart = new Date(now.getTime() - 14 * 24 * 36e5).toISOString().slice(0, 10);
  const horizonEnd = new Date(now.getTime() + 14 * 24 * 36e5).toISOString().slice(0, 10);

  // Resolve the platform's booking-code prefix once per cron tick so every
  // generated message uses the same code the guest/host see in the UI.
  const { data: ps } = await admin
    .from("platform_settings")
    .select("booking_id_prefix, booking_id_length")
    .maybeSingle();
  const codePrefix = (ps?.booking_id_prefix as string | null) || "BK";
  const codeLength = Number(ps?.booking_id_length ?? 8);

  // Admin-controlled global disable list. Keys present here are skipped
  // entirely by the cron — no thread row, no notification, and the
  // `last_reminder_sent` map is left untouched so re-enabling resumes
  // delivery from the next eligible window.
  const { data: psDisable } = await admin
    .from("platform_settings")
    .select("disabled_auto_messages, auto_message_templates, auto_message_timings, custom_auto_messages")
    .maybeSingle();
  const disabledKeys = new Set<string>(
    (psDisable?.disabled_auto_messages as string[] | null) ?? [],
  );
  const templateOverrides =
    (psDisable?.auto_message_templates as Record<string, string> | null) ?? null;
  const timingOverrides =
    (psDisable?.auto_message_timings as Record<
      string,
      { startHrs?: number; endHrs?: number }
    > | null) ?? null;
  // Admin-defined custom auto-messages. Each is processed once per booking
  // (deduped via last_reminder_sent[`custom_<id>`]) and only fires inside its
  // [startHrs, endHrs] window relative to the chosen anchor.
  type CustomAutoMessage = {
    id: string;
    label: string;
    anchor: "check_in" | "check_out";
    direction: "host_to_guest" | "guest_to_host";
    startHrs: number;
    endHrs?: number | null;
    template: string;
    enabled?: boolean;
  };
  const customMessages: CustomAutoMessage[] = Array.isArray(psDisable?.custom_auto_messages)
    ? (psDisable!.custom_auto_messages as CustomAutoMessage[])
    : [];

  const { data: bookings, error } = await admin
    .from("bookings")
    .select("id, guest_id, host_id, property_id, status, check_in_date, check_out_date, num_guests, actual_check_in_at, no_show_marked_at, last_reminder_sent, properties(title, check_in_time, check_out_time, latitude, longitude, address, city)")
    .in("status", ["confirmed", "in_progress", "completed"])
    .gte("check_in_date", horizonStart)
    .lte("check_in_date", horizonEnd);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stats = {
    reminders: 0,
    notifications: 0,
    noShows: 0,
    completed: 0,
    scanned: bookings?.length ?? 0,
    reviewsPublished: 0,
    expired: 0,
    inProgress: 0,
    pendingReconciled: 0,
  };

  // ---------------------------------------------------------------------
  // Pending-payment reconciliation sweep.
  //   When a guest closes their tab before Stripe's success redirect (or
  //   the redirect itself drops), the booking row stays `pending` forever
  //   even though Stripe has the money. The cron picks them up here, calls
  //   `confirm-booking-payment` (which is fully idempotent and re-checks
  //   Stripe), and the row flips to confirmed / pending_host_approval just
  //   like the foreground path. We only sweep rows older than 2 minutes so
  //   we don't race with the user's own immediate confirm call.
  // ---------------------------------------------------------------------
  const twoMinAgo = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
  const { data: stuck } = await admin
    .from("bookings")
    .select("id")
    .eq("status", "pending")
    .lt("created_at", twoMinAgo)
    .gte("check_in_date", now.toISOString().slice(0, 10))
    .limit(50);

  for (const row of (stuck ?? []) as { id: string }[]) {
    try {
      const res = await admin.functions.invoke("confirm-booking-payment", {
        body: { bookingId: row.id },
      });
      if (!res.error) stats.pendingReconciled++;
    } catch (e) {
      console.error("[process-stay-lifecycle] pending-reconcile failed", row.id, e);
    }
  }

  // ---------------------------------------------------------------------
  // Phase 1 — Section 5.2 step 14: Request-to-Book expiry.
  //   Any booking still sitting in PENDING_HOST_APPROVAL past its 24-hour
  //   deadline is auto-flipped to EXPIRED, the calendar is released,
  //   and both parties are notified. Counts as a missed request in host
  //   metrics.
  // ---------------------------------------------------------------------
  const { data: expiredRequests } = await admin
    .from("bookings")
    .select("id, guest_id, host_id, property_id, total_price, properties(title)")
    .eq("status", "pending_host_approval")
    .lt("host_approval_deadline", now.toISOString());

  for (const b of (expiredRequests ?? []) as any[]) {
    const { error: expErr } = await admin
      .from("bookings")
      .update({
        status: "expired",
        cancellation_reason: "Host did not respond within 24 hours — request expired. Payment authorisation released.",
        refund_status: "refunded",
        refund_amount: b.total_price,
        refund_date: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", b.id)
      .eq("status", "pending_host_approval");
    if (expErr) continue;
    stats.expired++;

    // System messages to both parties.
    await admin.from("messages").insert([
      {
        booking_id: b.id,
        sender_id: b.host_id,
        receiver_id: b.guest_id,
        content: `⏰ Your booking request for ${b.properties?.title ?? 'this property'} expired — the host didn't respond within 24 hours. Your payment authorisation has been released.`,
        message_type: "system",
      },
      {
        booking_id: b.id,
        sender_id: b.guest_id,
        receiver_id: b.host_id,
        content: `⚠️ Booking request from a guest expired — you didn't respond within 24 hours. This counts as a missed request in your host metrics.`,
        message_type: "system",
      },
    ]);

    // In-app notifications to both parties (bell badge).
    await admin.from("notification_log").insert([
      {
        user_id: b.guest_id,
        channel: "in_app",
        event_type: "booking_declined",
        subject: "Booking request expired",
        body: `Your request for ${b.properties?.title ?? 'this property'} expired — the host didn't respond within 24 hours. Your card has not been charged.`,
        related_entity_id: b.id,
        related_entity_type: "booking",
        status: "sent",
        sent_at: now.toISOString(),
      },
      {
        user_id: b.host_id,
        channel: "in_app",
        event_type: "booking_declined",
        subject: "Missed booking request",
        body: `A booking request expired — you didn't respond within 24 hours. This counts as a missed request in your host metrics.`,
        related_entity_id: b.id,
        related_entity_type: "booking",
        status: "sent",
        sent_at: now.toISOString(),
      },
    ]);
  }

  for (const b of (bookings ?? []) as BookingRow[]) {
    const sent = b.last_reminder_sent || {};
    const checkInAt = checkInDateTime(b);
    const checkOutTime = b.properties?.check_out_time || "11:00:00";
    const checkOutAt = new Date(`${b.check_out_date}T${checkOutTime}Z`);
    const hoursToCheckIn = hoursUntil(checkInAt, now);
    const hoursSinceCheckIn = -hoursToCheckIn;
    const code = bookingCode(b.id, codePrefix, codeLength);
    const newSent = { ...sent };
    let mutated = false;

    // Helper: insert a system message host↔guest in the booking thread.
    const sendThreadMessage = async (
      key: ReminderKey,
      senderId: string,
      receiverId: string,
    ) => {
      await admin.from("messages").insert({
        booking_id: b.id,
        sender_id: senderId,
        receiver_id: receiverId,
        content: buildReminderContent(key, b, code, templateOverrides),
        message_type: "system",
      });
      newSent[key] = now.toISOString();
      mutated = true;
      stats.reminders++;
    };

    // Pure helper decides which keys are eligible right now, honouring the
    // global admin disable list and the per-booking `last_reminder_sent`
    // map. This keeps the dedup contract testable.
    const due = dueReminders(b as any, now, disabledKeys, timingOverrides) as HelperReminderKey[];
    for (const key of due) {
      if (key === "pre_24h") {
        await sendThreadMessage("pre_24h", b.host_id, b.guest_id);
      } else if (key === "pre_12h") {
        await sendThreadMessage("pre_12h", b.guest_id, b.host_id);
      } else if (key === "host_no_confirm") {
        await sendThreadMessage("host_no_confirm", b.host_id, b.guest_id);
      } else if (key === "no_show") {
        await sendThreadMessage("no_show", b.host_id, b.guest_id);
      } else if (key === "post_review_guest") {
        await sendThreadMessage("post_review_guest", b.host_id, b.guest_id);
      } else if (key === "post_review_host") {
        await sendThreadMessage("post_review_host", b.guest_id, b.host_id);
      }
    }

    // -------------------------------------------------------------------
    // Admin-defined custom auto-messages. Same dedup contract as built-in
    // reminders: each fires at most once per booking, and only while
    // hoursFromAnchor is inside [startHrs, endHrs).
    // -------------------------------------------------------------------
    for (const cm of customMessages) {
      if (cm.enabled === false) continue;
      if (!cm.id || !cm.template) continue;
      const dedupKey = `custom_${cm.id}`;
      if (sent[dedupKey]) continue;
      const anchorAt = cm.anchor === "check_out" ? checkOutAt : checkInAt;
      const hrsFromAnchor = (now.getTime() - anchorAt.getTime()) / 36e5;
      const start = Number(cm.startHrs);
      const end = typeof cm.endHrs === "number" ? Number(cm.endHrs) : null;
      if (!Number.isFinite(start)) continue;
      if (hrsFromAnchor < start) continue;
      if (end !== null && hrsFromAnchor >= end) continue;
      const senderId = cm.direction === "guest_to_host" ? b.guest_id : b.host_id;
      const receiverId = cm.direction === "guest_to_host" ? b.host_id : b.guest_id;
      const content = renderTemplate(cm.template, {
        code,
        title: b.properties?.title || "your stay",
        maps: mapsLink(b),
        check_in: b.check_in_date,
        check_out: b.check_out_date,
        guests: `${b.num_guests} guest${b.num_guests > 1 ? "s" : ""}`,
      });
      const { error: insErr } = await admin.from("messages").insert({
        booking_id: b.id,
        sender_id: senderId,
        receiver_id: receiverId,
        content,
        message_type: "system",
      });
      if (!insErr) {
        newSent[dedupKey] = now.toISOString();
        mutated = true;
        stats.reminders++;
      }
    }

    // No-show flagging: 24h+ after check-in time, still no arrival confirmation.
    if (
      (b.status === "confirmed" || b.status === "in_progress") &&
      hoursSinceCheckIn >= 24 &&
      !b.actual_check_in_at &&
      !b.no_show_marked_at
    ) {
      const { error: nsErr } = await admin
        .from("bookings")
        .update({ no_show_marked_at: now.toISOString() })
        .eq("id", b.id);
      if (!nsErr) {
        stats.noShows++;
      }
    }

    // IN_PROGRESS — guest has confirmed arrival, stay is active.
    if (b.status === "confirmed" && b.actual_check_in_at && now < checkOutAt) {
      const { error: ipErr } = await admin
        .from("bookings")
        .update({ status: "in_progress" })
        .eq("id", b.id)
        .eq("status", "confirmed");
      if (!ipErr) stats.inProgress++;
    }

    // Auto-complete once scheduled check-out time has passed.
    let isCompleted = b.status === "completed";
    if (
      (b.status === "confirmed" || b.status === "in_progress") &&
      now > checkOutAt &&
      !b.no_show_marked_at
    ) {
      const { error: cErr } = await admin
        .from("bookings")
        .update({ status: "completed", actual_check_out_at: now.toISOString() })
        .eq("id", b.id)
        .in("status", ["confirmed", "in_progress"]);
      if (!cErr) {
        stats.completed++;
        isCompleted = true;
      }
    }

    if (mutated) {
      await admin
        .from("bookings")
        .update({ last_reminder_sent: newSent })
        .eq("id", b.id);
    }
  }

  // ----------------------------------------------------------------------
  // Double-blind mutual reviews: window-expiry auto-publish.
  // Any unpublished review whose review_window_closes_at has passed becomes
  // public, even if the counterpart never submitted. Solo reviews go live.
  // ----------------------------------------------------------------------
  const { data: expired, error: expErr } = await admin
    .from("mutual_reviews")
    .select("id, booking_id")
    .eq("is_published", false)
    .lt("review_window_closes_at", now.toISOString());

  if (!expErr && expired && expired.length > 0) {
    const ids = expired.map((r: { id: string }) => r.id);
    const { error: pubErr } = await admin
      .from("mutual_reviews")
      .update({ is_published: true })
      .in("id", ids);
    if (!pubErr) stats.reviewsPublished = ids.length;
  }

  return new Response(JSON.stringify({ ok: true, stats }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});