import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  it: "Italian",
  zh: "Chinese (Simplified)",
  ja: "Japanese",
  ko: "Korean",
  ar: "Arabic",
  hi: "Hindi",
  ru: "Russian",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, targetLanguage, messageId } = await req.json();
    if (!text || typeof text !== "string") {
      return new Response(JSON.stringify({ error: "Missing text" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const targetCode = (targetLanguage || "en").split("-")[0];
    const targetName = LANGUAGE_NAMES[targetCode] || "English";

    // Set up an admin client (service role) for cache reads/writes. Cache is
    // keyed by (message_id, target_language) so each message is translated
    // into a given language exactly once across the whole platform.
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const admin = supabaseUrl && serviceKey
      ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
      : null;

    // 1. Cache lookup
    if (admin && messageId) {
      const { data: cached } = await admin
        .from("message_translations")
        .select("translation")
        .eq("message_id", messageId)
        .eq("target_language", targetCode)
        .maybeSingle();
      if (cached?.translation) {
        return new Response(
          JSON.stringify({ translation: cached.translation, targetLanguage: targetCode, cached: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "AI gateway not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content:
              `You are a translation engine. Translate the user's message into ${targetName}. ` +
              `Reply with ONLY the translated text — no quotes, no explanations, no language labels. ` +
              `Preserve emoji, line breaks, and proper nouns. If the message is already in ${targetName}, return it unchanged.`,
          },
          { role: "user", content: text },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("[translate-message] gateway error", resp.status, errText);
      return new Response(JSON.stringify({ error: "Translation failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await resp.json();
    const translation = data?.choices?.[0]?.message?.content?.trim() ?? text;

    // 2. Persist to cache for future requests (best-effort).
    if (admin && messageId) {
      admin
        .from("message_translations")
        .upsert(
          { message_id: messageId, target_language: targetCode, translation },
          { onConflict: "message_id,target_language" },
        )
        .then(({ error }) => {
          if (error) console.error("[translate-message] cache write failed", error);
        });
    }

    return new Response(
      JSON.stringify({ translation, targetLanguage: targetCode, cached: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[translate-message] failure", err);
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});