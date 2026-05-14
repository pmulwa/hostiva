// Mirror externally-hosted image URLs (e.g. Airbnb / Booking CDNs) into our
// own `property-images` storage bucket so they always render in the app and
// never break due to hotlink protection, CORS, or upstream URL expiry.
//
// Input  : { urls: string[], host_id: string }
// Output : { mirrored: { source: string, url: string }[], failed: string[] }
//
// Notes
// - Runs with the service role to write into `property-images` regardless of
//   bucket RLS. The caller's auth is verified by Supabase via verify_jwt.
// - Skips URLs that are already on the project's storage host (already mirrored).
// - Validates content-type is an image and minimum byte size to filter out
//   tracking pixels / blocked-page placeholders.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "property-images";
const MIN_BYTES = 5 * 1024;     // 5KB — lowered to catch compressed Airbnb thumbnails
const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPT_TYPES = /^image\/(jpeg|jpg|png|webp|avif|heic|heif)$/i;

/**
 * Read width/height from a JPEG / PNG / WebP byte buffer without decoding pixels.
 * Returns null if it's not a recognised format we can sniff.
 *
 * Used to reject Airbnb's blank placeholder tiles, which often arrive as tiny
 * (e.g. 8x8) or as suspiciously-low-byte images at full advertised dimensions.
 */
function sniffDimensions(buf: Uint8Array): { w: number; h: number } | null {
  // PNG: 8-byte signature, then IHDR chunk at offset 16: w (BE u32), h (BE u32)
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const w = (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19];
    const h = (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23];
    return { w, h };
  }
  // JPEG: scan for SOF0/2 markers (FFC0..FFCF except FFC4/C8/CC)
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0xd9) { i += 2; continue; }
      const segLen = (buf[i + 2] << 8) | buf[i + 3];
      const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF) {
        const h = (buf[i + 5] << 8) | buf[i + 6];
        const w = (buf[i + 7] << 8) | buf[i + 8];
        return { w, h };
      }
      i += 2 + segLen;
    }
  }
  // WebP (VP8/VP8L/VP8X) — best-effort
  if (buf.length > 30 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
      && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    // VP8X
    if (buf[12] === 0x56 && buf[13] === 0x50 && buf[14] === 0x38 && buf[15] === 0x58) {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { w, h };
    }
    // VP8 (lossy): "VP8 " then 4-byte size, then frame tag (3) + start code (3) + width (2) + height (2)
    if (buf[12] === 0x56 && buf[13] === 0x50 && buf[14] === 0x38 && buf[15] === 0x20) {
      const w = ((buf[26] | (buf[27] << 8)) & 0x3fff);
      const h = ((buf[28] | (buf[29] << 8)) & 0x3fff);
      return { w, h };
    }
  }
  return null;
}

/**
 * Cheap "is this image blank / nearly-uniform" check using bytes-per-megapixel.
 *
 * Photo content has a lot of high-frequency detail, so JPEG/WebP encoders rarely
 * produce files smaller than ~25 KB per megapixel at quality 70+. A blank-white
 * Airbnb placeholder at 2048x1365 (2.8 MP) typically arrives at 5–10 KB total —
 * a dead giveaway.
 */
function looksBlankByCompression(buf: Uint8Array, dim: { w: number; h: number }): boolean {
  if (dim.w <= 0 || dim.h <= 0) return false;
  const mp = (dim.w * dim.h) / 1_000_000;
  if (mp < 0.05) return true; // anything under ~50k px is a thumbnail / icon, not a listing photo
  const bpmp = buf.byteLength / mp;
  // Real photos: typically > 80 KB per MP. Blank/flat-color stand-ins: < 20 KB per MP.
  return bpmp < 20_000;
}

function extFromContentType(ct: string | null): string {
  if (!ct) return "jpg";
  const m = /image\/(jpe?g|png|webp|avif|heic|heif)/i.exec(ct);
  if (!m) return "jpg";
  return m[1].toLowerCase().replace("jpeg", "jpg");
}

async function mirrorOne(
  client: ReturnType<typeof createClient>,
  hostId: string,
  url: string,
  publicHost: string,
): Promise<{ ok: true; source: string; url: string } | { ok: false; source: string; reason: string }> {
  // Already in our bucket? Pass through.
  if (publicHost && url.includes(publicHost)) return { ok: true, source: url, url };

  let res: Response;
  try {
    // Detect platform for platform-specific headers
    const isAirbnb = url.includes('muscache.com') || url.includes('airbnb');
    const isBooking = url.includes('bstatic.com') || url.includes('booking.com');

    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Sec-Fetch-Dest": "image",
      "Sec-Fetch-Mode": "no-cors",
      "Sec-Fetch-Site": "cross-site",
    };
    if (isAirbnb) {
      headers["Referer"] = "https://www.airbnb.com/";
      headers["Origin"] = "https://www.airbnb.com";
    }
    if (isBooking) {
      headers["Referer"] = "https://www.booking.com/";
    }

    res = await fetch(url, { headers, redirect: "follow" });

    // If 403/blocked, try without extra headers (some CDNs block non-browser UA)
    if (!res.ok && (res.status === 403 || res.status === 401)) {
      res = await fetch(url, {
        headers: { "User-Agent": "curl/7.88.1", "Accept": "*/*" },
        redirect: "follow",
      });
    }
  } catch (e) {
    return { ok: false, source: url, reason: `fetch failed: ${String(e)}` };
  }
  if (!res.ok) return { ok: false, source: url, reason: `HTTP ${res.status}` };

  const ct = res.headers.get("content-type");
  if (!ct || !ACCEPT_TYPES.test(ct)) return { ok: false, source: url, reason: `bad content-type: ${ct}` };

  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength < MIN_BYTES) return { ok: false, source: url, reason: "too small (likely not a real photo)" };
  if (buf.byteLength > MAX_BYTES) return { ok: false, source: url, reason: "too large" };

  // Check minimum dimensions only — skip blank compression check as it
  // incorrectly rejects valid Airbnb WebP images that are highly compressed.
  const dim = sniffDimensions(buf);
  if (dim && (dim.w < 200 || dim.h < 150)) {
    return { ok: false, source: url, reason: `too small (${dim.w}x${dim.h})` };
  }

  const ext = extFromContentType(ct);
  const key = `imports/${hostId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const { error } = await client.storage.from(BUCKET).upload(key, buf, {
    contentType: ct,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) return { ok: false, source: url, reason: `upload: ${error.message}` };

  const { data } = client.storage.from(BUCKET).getPublicUrl(key);
  return { ok: true, source: url, url: data.publicUrl };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Identify the caller using their JWT
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const urls: string[] = Array.isArray(body.urls) ? body.urls.filter((x: unknown) => typeof x === "string") : [];
    if (urls.length === 0) {
      return new Response(JSON.stringify({ mirrored: [], failed: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const publicHost = (() => { try { return new URL(SUPABASE_URL).host; } catch { return ""; } })();

    // Limit concurrency to be polite to upstream CDNs.
    const CONCURRENCY = 5;
    const mirrored: { source: string; url: string }[] = [];
    const failed: { source: string; reason: string }[] = [];
    let cursor = 0;
    const workers: Promise<void>[] = [];

    console.log(`[mirror-image-urls] Processing ${urls.length} URLs for user ${u.user.id}`);

    for (let i = 0; i < CONCURRENCY; i++) {
      workers.push((async () => {
        while (cursor < urls.length) {
          const idx = cursor++;
          const r = await mirrorOne(admin, u.user.id, urls[idx], publicHost);
          if (r.ok) {
            mirrored.push({ source: r.source, url: r.url });
            console.log(`[mirror-image-urls] ✅ Mirrored: ${r.source.slice(0, 60)}`);
          } else {
            failed.push({ source: r.source, reason: r.reason });
            console.warn(`[mirror-image-urls] ❌ Failed: ${r.source.slice(0, 60)} — ${r.reason}`);
          }
        }
      })());
    }
    await Promise.all(workers);

    console.log(`[mirror-image-urls] Done: ${mirrored.length} mirrored, ${failed.length} failed`);

    return new Response(JSON.stringify({ mirrored, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});