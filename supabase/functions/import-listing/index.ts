import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Image filtering helpers ────────────────────────────────

const EXCLUDE_PATTERNS = [
  'avatar', 'profile', 'user', 'host', 'logo', 'icon', 'favicon',
  'badge', 'flag', 'emoji', 'sprite', 'button', 'arrow', 'star',
  'rating', 'check', 'verified', 'superhost', 'map-pin', 'marker',
  'placeholder', 'blank', 'spacer', 'pixel', 'tracking', 'analytics',
  'google', 'facebook', 'twitter', 'social', 'share', 'like',
  'banner', 'ad-', 'advert', 'promo-', 'notification', 'modal',
  'tooltip', 'dropdown', 'menu-', 'nav-', 'header-logo', 'footer',
  'payment', 'visa', 'mastercard', 'paypal', 'stripe', 'amex',
  'loading', 'spinner', 'skeleton', 'shimmer',
  'w_32', 'w_48', 'w_64', 'h_32', 'h_48', 'h_64',
  '1x1', '2x2', '.gif', '.svg',
  '/static/', '/assets/icons', '/assets/logo', 'brand-',
  'country-flag', 'lang-', 'locale',
];

/**
 * Quality guidelines for imported listing photos:
 *   - Long edge ≥ 2048 px when CDN supports it
 *   - JPG/WebP preferred (we leave the CDN's format choice intact)
 *   - Drop tiny thumbnails entirely (long edge < 600 px)
 *
 * Most listing platforms expose the same image at multiple resolutions via
 * URL parameters. We rewrite known CDN URLs to request the high-res variant
 * before we hand the URL to the AI / save it on the listing.
 */
const TARGET_LONG_EDGE = 2048;
const MIN_LONG_EDGE = 600;

function upgradeImageQuality(rawUrl: string): string {
  let url = rawUrl;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();

    // Airbnb (muscache.com): supports ?im_w=2048
    if (host.includes('muscache.com') || host.includes('airbnb')) {
      u.searchParams.set('im_w', String(TARGET_LONG_EDGE));
      // Some Airbnb URLs also accept im_q (quality)
      if (u.searchParams.has('im_q')) u.searchParams.set('im_q', 'highq');
      url = u.toString();
    }

    // Booking.com (bstatic.com / cf.bstatic.com): /images/hotel/max1920/...
    else if (host.includes('bstatic.com') || host.includes('booking.com')) {
      url = url.replace(/\/max\d+\//, `/max${TARGET_LONG_EDGE}/`);
      url = url.replace(/\/square\d+\//, `/max${TARGET_LONG_EDGE}/`);
    }

    // Vrbo / HomeAway (vrbo.com / homeaway.com): often expose .jpg?width=...
    else if (host.includes('vrbo.com') || host.includes('homeaway.com') || host.includes('vacasa')) {
      u.searchParams.set('width', String(TARGET_LONG_EDGE));
      u.searchParams.delete('crop');
      url = u.toString();
    }

    // Expedia / Trivago CDNs (mediaim.expedia.com): support ?impolicy=fcrop
    else if (host.includes('expedia') || host.includes('mediaim')) {
      url = url.replace(/[?&](w|width)=\d+/gi, '');
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}impolicy=resizecrop&rw=${TARGET_LONG_EDGE}`;
    }

    // Tripadvisor (tacdn.com): /photo-w<width>-...
    else if (host.includes('tacdn.com') || host.includes('tripadvisor')) {
      url = url.replace(/\/photo-w\d+-/, `/photo-w${TARGET_LONG_EDGE}-`);
      url = url.replace(/\/photo-s\d+-/, `/photo-w${TARGET_LONG_EDGE}-`);
    }

    // Generic Cloudinary URLs: /upload/w_xxx,q_xx/
    else if (host.includes('cloudinary')) {
      url = url.replace(
        /\/upload\/(?:[^/]+\/)?/,
        `/upload/w_${TARGET_LONG_EDGE},q_85,f_auto/`,
      );
    }

    // Generic Imgix / similar: ?w=&h=&q=
    else if (u.searchParams.has('w') || u.searchParams.has('width')) {
      u.searchParams.set('w', String(TARGET_LONG_EDGE));
      u.searchParams.delete('h');
      u.searchParams.set('q', '85');
      url = u.toString();
    }
  } catch {
    // If URL parsing fails, fall back to the raw URL
  }

  return url;
}

/** Best-effort detection of a URL's encoded width to drop tiny variants. */
function inferUrlWidth(url: string): number | null {
  const lower = url.toLowerCase();
  const patterns: RegExp[] = [
    /im_w=(\d+)/, /[?&]w(?:idth)?=(\d+)/, /\/max(\d+)\//,
    /\/photo-w(\d+)-/, /\/w_(\d+)[,/]/, /-(\d{3,4})x\d{3,4}\./,
  ];
  for (const re of patterns) {
    const m = lower.match(re);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function isPropertyImage(url: string): boolean {
  const lower = url.toLowerCase();

  // Must be a real image file
  if (!lower.match(/\.(jpg|jpeg|png|webp|avif)/)) return false;

  // Exclude known non-property patterns
  if (EXCLUDE_PATTERNS.some(p => lower.includes(p))) return false;

  // Drop URLs we can prove are below the quality floor
  const inferred = inferUrlWidth(lower);
  if (inferred !== null && inferred < MIN_LONG_EDGE) return false;

  // Generic small image detection from URL dimensions
  const dimMatch = lower.match(/(\d+)x(\d+)/);
  if (dimMatch) {
    const w = parseInt(dimMatch[1]);
    const h = parseInt(dimMatch[2]);
    if (w < 400 || h < 400) return false;
    // Skip if it's a square icon size (e.g. 48x48, 64x64)
    if (w === h && w <= 128) return false;
  }

  return true;
}

function extractImages(html: string, markdown: string, links: string[]): string[] {
  const found: string[] = [];

  // img src, data-original-uri, data-src
  const imgSrcRegex = /(?:src|data-original-uri|data-src)=["'](https?:\/\/[^"'\s]+\.(?:jpg|jpeg|png|webp|avif)[^"'\s]*)/gi;
  let match;
  while ((match = imgSrcRegex.exec(html)) !== null) found.push(match[1]);

  // srcset
  const srcsetRegex = /srcset=["']([^"']+)/gi;
  while ((match = srcsetRegex.exec(html)) !== null) {
    for (const part of match[1].split(',')) {
      const urlMatch = part.trim().match(/^(https?:\/\/[^\s]+)/);
      if (urlMatch) found.push(urlMatch[1]);
    }
  }

  // Markdown images
  const mdImageRegex = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/gi;
  while ((match = mdImageRegex.exec(markdown)) !== null) found.push(match[1]);

  // Link images
  const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
  for (const link of links) {
    if (imageExts.some(ext => link.toLowerCase().includes(ext))) found.push(link);
  }

  // Upgrade each URL to its high-resolution variant, then dedupe + filter
  const upgraded = found.map(upgradeImageQuality);
  return [...new Set(upgraded)].filter(isPropertyImage).slice(0, 30);
}

// ─── Main handler ───────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { url, platform } = await req.json();
    if (!url) {
      return new Response(JSON.stringify({ error: "URL is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── URL Validation ─────────────────────────────────────
    const trimmedUrl = url.trim();
    
    // Must be a valid URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmedUrl);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid URL format. Please provide a valid listing URL (e.g., https://www.airbnb.com/rooms/12345)." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Must be https
    if (parsedUrl.protocol !== "https:") {
      return new Response(JSON.stringify({ error: "URL must use HTTPS. Please provide a secure listing URL." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Platform-specific URL validation
    const validDomains: Record<string, string[]> = {
      airbnb: ["airbnb.com", "airbnb.co.uk", "airbnb.ca", "airbnb.com.au", "airbnb.de", "airbnb.fr", "airbnb.es", "airbnb.it", "airbnb.co.in", "airbnb.co.ke"],
      booking: ["booking.com"],
      vrbo: ["vrbo.com", "homeaway.com"],
      expedia: ["expedia.com", "expedia.co.uk", "expedia.ca"],
      tripadvisor: ["tripadvisor.com", "tripadvisor.co.uk", "tripadvisor.ca"],
    };

    // Validate the URL matches the selected platform
    const hostname = parsedUrl.hostname.replace(/^www\./, "");
    if (platform && platform !== "other") {
      const allowedDomains = validDomains[platform] || [];
      const matchesPlatform = allowedDomains.some(d => hostname === d || hostname.endsWith("." + d));
      if (!matchesPlatform) {
        return new Response(JSON.stringify({ 
          error: `This URL doesn't appear to be from ${platform}. The domain "${hostname}" is not recognized. Please paste a valid ${platform} listing URL or select "Other" as your platform.` 
        }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Airbnb-specific: must be a listing page (e.g., /rooms/12345)
    if (platform === "airbnb") {
      const path = parsedUrl.pathname;
      if (!path.match(/^\/(rooms|luxury)\/\d+/) && !path.match(/^\/h\/[a-z0-9-]+/)) {
        return new Response(JSON.stringify({ 
          error: "This doesn't look like an Airbnb listing page. Please paste a direct listing URL like https://www.airbnb.com/rooms/12345 — not a search page, homepage, or booking confirmation." 
        }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Booking.com-specific: must be a hotel page
    if (platform === "booking") {
      const path = parsedUrl.pathname;
      if (!path.includes("/hotel/")) {
        return new Response(JSON.stringify({ 
          error: "This doesn't look like a Booking.com property page. Please paste a direct hotel/property URL like https://www.booking.com/hotel/us/hotel-name.html" 
        }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Generic: reject known non-listing pages
    const rejectedPaths = ["/search", "/s/", "/login", "/signup", "/help", "/contact", "/about"];
    if (rejectedPaths.some(p => parsedUrl.pathname.toLowerCase().startsWith(p))) {
      return new Response(JSON.stringify({ 
        error: "This looks like a search, login, or help page — not a property listing. Please paste a direct link to a specific property." 
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) {
      return new Response(JSON.stringify({ error: "Firecrawl is not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Scraping listing from ${platform}: ${url}`);

    const scrapeResponse = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: url.trim(),
        formats: ["markdown", "html", "links"],
        onlyMainContent: false,
        waitFor: 5000,
      }),
    });

    if (!scrapeResponse.ok) {
      const errText = await scrapeResponse.text();
      console.error("Firecrawl error:", scrapeResponse.status, errText);
      return new Response(
        JSON.stringify({ error: `Failed to scrape listing (${scrapeResponse.status})` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const scrapeData = await scrapeResponse.json();
    const markdown = scrapeData?.data?.markdown || scrapeData?.markdown || "";
    const html = scrapeData?.data?.html || scrapeData?.html || "";
    const links = scrapeData?.data?.links || scrapeData?.links || [];

    const allPropertyImages = extractImages(html, markdown, links as string[]);

    if (!markdown || markdown.length < 50) {
      return new Response(
        JSON.stringify({ error: "Could not extract content from the listing. The page may be private or paywalled." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: AI extraction using Claude
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
    if (!GROQ_API_KEY) {
      return new Response(JSON.stringify({ error: "AI service not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are a property listing data extractor. Given scraped content from a ${platform} listing page, extract structured property data accurately.

PRICING RULES:
- Extract the EXACT nightly price shown on the listing page
- Look for patterns like "$XXX per night", "$XXX/night", "€XXX per night"
- If discounted, use the CURRENT/discounted price
- Convert to numeric value only (no currency symbols)
- Look for cleaning fee separately

IMAGE RULES:
- For image_urls, ONLY include property/room photos
- NEVER include profile photos, avatars, icons, logos, maps, UI elements, payment icons, brand logos
- Only include images that show rooms, building exterior, amenities (pool, gym), views, or property features
- Prefer high-resolution versions

LOCATION RULES:
- Extract the EXACT address, city, state/province, country, and postal code
- If GPS coordinates are available in the page content, extract them
- Be precise with the city and country names

PROPERTY TYPE RULES:
- Determine the property_type from the listing (apartment, house, villa, cabin, etc.)
- Determine the place_type: "entire" for entire home, "private" for private room, "shared" for shared room, "hotel" for hotel
- Determine a category that best fits: Beachfront, Cabins, Trending, Countryside, Amazing Pools, Islands, Lakefront, National Parks, Design, Castles, Luxury, Treehouses, Tropical, Camping, Farms, Skiing

AMENITY RULES:
- Extract ALL amenities mentioned on the page
- Use standard names: wifi, kitchen, parking, air conditioning, tv, heating, gym, pool, hot tub, washer, dryer, iron, hair dryer, microwave, refrigerator, dishwasher, coffee maker, oven, dining table, sauna, ev charger, balcony, garden, bbq grill, mountain view, lake access, beach access, bikes, camping gear, game console, board games, sound system, projector, library, baby crib, high chair, pets allowed, smoke detector, fire extinguisher, first aid kit, security cameras, safe, gated property, walk-in closet
- Include as many as found on the page`;

    const userPrompt = `Extract the property listing details from this content. Here are property image URLs found on the page: ${JSON.stringify(allPropertyImages.slice(0, 20))}

Page content:

${markdown.slice(0, 12000)}

Return ONLY a valid JSON object with these fields (no markdown, no backticks):
{
  "title": "string",
  "description": "string",
  "property_type": "apartment|house|villa|cabin|cottage|loft|studio|penthouse|resort|hotel",
  "place_type": "entire|private|shared|hotel",
  "category": "Beachfront|Cabins|Trending|Countryside|Amazing Pools|Islands|Lakefront|National Parks|Design|Castles|Luxury|Treehouses|Tropical|Camping|Farms|Skiing",
  "address": "string",
  "city": "string",
  "state": "string",
  "country": "string",
  "postal_code": "string",
  "latitude": number,
  "longitude": number,
  "bedrooms": number,
  "beds": number,
  "bathrooms": number,
  "max_guests": number,
  "price_per_night": number,
  "cleaning_fee": number,
  "currency": "USD|EUR|GBP|KES etc",
  "amenities": ["string"],
  "house_rules": ["string"],
  "check_in_time": "string",
  "check_out_time": "string",
  "image_urls": ["string - property photos only, never icons/logos/avatars"]
}`;

    const aiResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 4096,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please contact support." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI error:", aiResponse.status, errText);
      return new Response(JSON.stringify({ error: "AI extraction failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const rawText = aiData?.choices?.[0]?.message?.content ?? "";

    if (!rawText) {
      return new Response(JSON.stringify({ error: "AI could not extract listing data" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let extracted;
    try {
      // Strip markdown code fences if present
      const clean = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
      extracted = JSON.parse(clean);
    } catch {
      return new Response(JSON.stringify({ error: "Failed to parse extracted data" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Merge AI-extracted images with scraped property images, upgrading URLs to
    // the high-resolution CDN variant and applying the quality filter.
    const aiImages = ((extracted.image_urls || []) as string[]).map(upgradeImageQuality);
    const finalImages = [...new Set([...aiImages, ...allPropertyImages])]
      .map(upgradeImageQuality)
      .filter(isPropertyImage)
      .slice(0, 30);
    extracted.image_urls = finalImages;

    // Geocode if we have city+country but no coordinates
    if (!extracted.latitude && extracted.city && extracted.country) {
      try {
        const geoQuery = [extracted.address, extracted.city, extracted.state, extracted.country].filter(Boolean).join(', ');
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(geoQuery)}&limit=1`, {
          headers: { 'User-Agent': 'HostlyApp/1.0' },
        });
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (geoData?.[0]) {
            extracted.latitude = parseFloat(geoData[0].lat);
            extracted.longitude = parseFloat(geoData[0].lon);
          }
        }
      } catch (e) {
        console.error("Geocoding failed:", e);
      }
    }

    console.log("Successfully extracted listing:", extracted.title, "with", finalImages.length, "images", "coords:", extracted.latitude, extracted.longitude);

    return new Response(JSON.stringify({ success: true, data: extracted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("import-listing error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});