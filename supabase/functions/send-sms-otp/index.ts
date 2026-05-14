// supabase/functions/send-sms-otp/index.ts
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone, action, code: submittedCode } = await req.json();

    const vonageApiKey = Deno.env.get("VONAGE_API_KEY");
    const vonageApiSecret = Deno.env.get("VONAGE_API_SECRET");

    if (!vonageApiKey || !vonageApiSecret) {
      throw new Error("Vonage credentials not configured");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get authenticated user
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) throw new Error("Unauthorized");

    if (action === "send") {
      // Generate 6-digit OTP
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      // Store OTP in database
      await supabase.from("otp_verifications").upsert({
        user_id: user.id,
        phone,
        code: otp,
        expires_at: expiresAt,
        verified: false,
      }, { onConflict: "user_id,phone" });

      // Send SMS via Vonage
      const vonageRes = await fetch("https://rest.nexmo.com/sms/json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: vonageApiKey,
          api_secret: vonageApiSecret,
          from: "HOSTIVA",
          to: phone,
          text: `Your Hostiva verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`,
        }),
      });

      const vonageData = await vonageRes.json();
      const messageStatus = vonageData?.messages?.[0]?.status;

      if (messageStatus !== "0") {
        const errorText = vonageData?.messages?.[0]?.["error-text"] || "Failed to send SMS";
        console.error("[send-sms-otp] Vonage error:", vonageData);
        throw new Error(errorText);
      }

      console.log("[send-sms-otp] SMS sent via Vonage to:", phone);

      return new Response(JSON.stringify({ success: true, message: "OTP sent successfully" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "verify") {
      // Verify submitted OTP
      const { data: otpRecord } = await supabase
        .from("otp_verifications")
        .select("*")
        .eq("user_id", user.id)
        .eq("phone", phone)
        .eq("verified", false)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (!otpRecord) {
        return new Response(
          JSON.stringify({ success: false, message: "Code expired or not found. Please request a new code." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }

      if (otpRecord.code !== submittedCode) {
        return new Response(
          JSON.stringify({ success: false, message: "Incorrect code. Please check the SMS and try again." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }

      // Mark OTP as verified
      await supabase.from("otp_verifications")
        .update({ verified: true })
        .eq("user_id", user.id)
        .eq("phone", phone);

      // Update profile phone
      await supabase.from("profiles")
        .update({ phone })
        .eq("user_id", user.id);

      // Upsert verification record
      const { data: existing } = await supabase
        .from("user_verifications")
        .select("id")
        .eq("user_id", user.id)
        .eq("verification_type", "phone")
        .maybeSingle();

      if (existing) {
        await supabase.from("user_verifications")
          .update({
            status: "verified",
            verified_at: new Date().toISOString(),
            data: { phone },
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("user_verifications").insert({
          user_id: user.id,
          verification_type: "phone",
          status: "verified",
          verified_at: new Date().toISOString(),
          data: { phone },
        });
      }

      console.log("[send-sms-otp] Phone verified successfully:", phone);

      return new Response(JSON.stringify({ success: true, message: "Phone verified successfully" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Invalid action. Use 'send' or 'verify'.");

  } catch (err) {
    console.error("[send-sms-otp] error:", err);
    return new Response(
      JSON.stringify({ success: false, message: err.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});