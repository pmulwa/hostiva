// supabase/functions/send-email-notification/index.ts
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FROM_EMAIL = "noreply@host-iva.com";
const FROM_NAME = "Hostiva";

async function sendEmail(apiKey: string, to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [to],
      subject,
      html,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Failed to send email");
  return data;
}

function bookingConfirmedGuestEmail(booking: any, property: any, guestName: string) {
  return {
    subject: `Booking Confirmed — ${property.title}`,
    html: `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <div style="max-width:600px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <!-- Header -->
        <div style="background:#1a1a2e;padding:32px 40px;text-align:center;">
          <h1 style="color:#ffffff;margin:0;font-size:28px;font-weight:700;letter-spacing:-0.5px;">Hostiva</h1>
          <p style="color:#a0aec0;margin:8px 0 0;font-size:14px;">Your booking is confirmed</p>
        </div>
        <!-- Green banner -->
        <div style="background:#22c55e;padding:20px 40px;text-align:center;">
          <p style="color:#ffffff;margin:0;font-size:20px;font-weight:600;">✓ Payment Successful</p>
        </div>
        <!-- Content -->
        <div style="padding:40px;">
          <p style="color:#374151;font-size:16px;margin:0 0 24px;">Hi ${guestName},</p>
          <p style="color:#374151;font-size:16px;margin:0 0 32px;">Your booking has been confirmed. Here are your details:</p>
          <!-- Booking details card -->
          <div style="background:#f9fafb;border-radius:8px;padding:24px;margin-bottom:32px;border:1px solid #e5e7eb;">
            <h2 style="color:#111827;font-size:18px;font-weight:600;margin:0 0 16px;">${property.title}</h2>
            <table style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:8px 0;color:#6b7280;font-size:14px;width:40%;">Booking Code</td>
                <td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;">BK-${booking.id.slice(0,8).toUpperCase()}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:8px 0;color:#6b7280;font-size:14px;">Check-in</td>
                <td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;">${booking.check_in_date}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:8px 0;color:#6b7280;font-size:14px;">Check-out</td>
                <td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;">${booking.check_out_date}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:8px 0;color:#6b7280;font-size:14px;">Guests</td>
                <td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;">${booking.num_guests}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:8px 0;color:#6b7280;font-size:14px;">Nights</td>
                <td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;">${booking.num_nights}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:8px 0;color:#6b7280;font-size:14px;">Total Paid</td>
                <td style="padding:8px 0;color:#22c55e;font-size:16px;font-weight:700;">$${Number(booking.total_price).toFixed(2)}</td>
              </tr>
            </table>
          </div>
          <p style="color:#6b7280;font-size:14px;margin:0 0 32px;">You can view your booking details and manage your stay from your Hostiva dashboard.</p>
          <!-- CTA Button -->
          <div style="text-align:center;margin-bottom:32px;">
            <a href="${Deno.env.get("SITE_URL") || "https://host-iva.com"}/bookings" 
               style="background:#1a1a2e;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;display:inline-block;">
              View My Booking
            </a>
          </div>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0;">
          <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">
            © ${new Date().getFullYear()} Hostiva. All rights reserved.<br>
            This email was sent to you because you made a booking on Hostiva.
          </p>
        </div>
      </div>
    </body>
    </html>
    `,
  };
}

function bookingNotificationHostEmail(booking: any, property: any, guestName: string, hostName: string) {
  return {
    subject: `New Booking — ${property.title} (BK-${booking.id.slice(0,8).toUpperCase()})`,
    html: `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <div style="max-width:600px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <div style="background:#1a1a2e;padding:32px 40px;text-align:center;">
          <h1 style="color:#ffffff;margin:0;font-size:28px;font-weight:700;letter-spacing:-0.5px;">Hostiva</h1>
          <p style="color:#a0aec0;margin:8px 0 0;font-size:14px;">New booking received</p>
        </div>
        <div style="background:#3b82f6;padding:20px 40px;text-align:center;">
          <p style="color:#ffffff;margin:0;font-size:20px;font-weight:600;">🎉 You have a new booking!</p>
        </div>
        <div style="padding:40px;">
          <p style="color:#374151;font-size:16px;margin:0 0 24px;">Hi ${hostName},</p>
          <p style="color:#374151;font-size:16px;margin:0 0 32px;">
            <strong>${guestName}</strong> has just booked <strong>${property.title}</strong> and payment has been confirmed.
          </p>
          <div style="background:#f9fafb;border-radius:8px;padding:24px;margin-bottom:32px;border:1px solid #e5e7eb;">
            <h2 style="color:#111827;font-size:18px;font-weight:600;margin:0 0 16px;">Booking Details</h2>
            <table style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:8px 0;color:#6b7280;font-size:14px;width:40%;">Booking Code</td>
                <td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;">BK-${booking.id.slice(0,8).toUpperCase()}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:8px 0;color:#6b7280;font-size:14px;">Guest</td>
                <td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;">${guestName}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:8px 0;color:#6b7280;font-size:14px;">Check-in</td>
                <td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;">${booking.check_in_date}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:8px 0;color:#6b7280;font-size:14px;">Check-out</td>
                <td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;">${booking.check_out_date}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:8px 0;color:#6b7280;font-size:14px;">Guests</td>
                <td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;">${booking.num_guests}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:8px 0;color:#6b7280;font-size:14px;">Nights</td>
                <td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;">${booking.num_nights}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:8px 0;color:#6b7280;font-size:14px;">Amount</td>
                <td style="padding:8px 0;color:#22c55e;font-size:16px;font-weight:700;">$${Number(booking.total_price).toFixed(2)}</td>
              </tr>
            </table>
          </div>
          <div style="text-align:center;margin-bottom:32px;">
            <a href="${Deno.env.get("SITE_URL") || "https://host-iva.com"}/host/bookings" 
               style="background:#1a1a2e;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;display:inline-block;">
              View Booking
            </a>
          </div>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0;">
          <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">
            © ${new Date().getFullYear()} Hostiva. All rights reserved.
          </p>
        </div>
      </div>
    </body>
    </html>
    `,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { type, bookingId } = await req.json();
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("RESEND_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Fetch booking with property
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("*, properties(title, city, country)")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError || !booking) throw new Error("Booking not found: " + bookingError?.message);

    const property = booking.properties;

    // Fetch guest profile
    const { data: guestProfile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("user_id", booking.guest_id)
      .maybeSingle();

    // Fetch host profile
    const { data: hostProfile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("user_id", booking.host_id)
      .maybeSingle();

    const guestName = guestProfile?.full_name || "Guest";
    const guestEmail = guestProfile?.email;
    const hostName = hostProfile?.full_name || "Host";
    const hostEmail = hostProfile?.email;

    if (type === "booking_confirmed") {
      // Email to guest
      if (guestEmail) {
        const { subject, html } = bookingConfirmedGuestEmail(booking, property, guestName);
        await sendEmail(resendApiKey, guestEmail, subject, html);
        console.log("[send-email-notification] Guest email sent to:", guestEmail);
      }

      // Email to host
      if (hostEmail) {
        const { subject, html } = bookingNotificationHostEmail(booking, property, guestName, hostName);
        await sendEmail(resendApiKey, hostEmail, subject, html);
        console.log("[send-email-notification] Host email sent to:", hostEmail);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[send-email-notification] error:", err);
    return new Response(JSON.stringify({ success: false, message: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});