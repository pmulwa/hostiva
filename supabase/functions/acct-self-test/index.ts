import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Admin-only accounting cycle self-test.
 *
 * Authorisation is hardened in three layers:
 *  1. Bearer token must be present.
 *  2. JWT must be cryptographically valid (verified via `getClaims`),
 *     proving the caller owns the token and it has not expired.
 *  3. The verified `sub` claim must map to an `admin` row in
 *     `public.user_roles`. We use the service-role client for this
 *     lookup so we never depend on the caller's RLS context.
 *
 * Only after all three pass do we execute the persistent SQL function
 * `public.acct_run_self_test()` using the caller's JWT, so the function's
 * own admin check (auth.uid() must be admin) also re-validates server-side.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, { error: "Server misconfigured" });
  }

  // ---- Layer 1: bearer token must be present ----
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json(401, { error: "Missing bearer token" });
  }
  const token = authHeader.slice(7).trim();
  if (!token) return json(401, { error: "Empty bearer token" });

  // ---- Layer 2: JWT must verify cryptographically ----
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: claimsData, error: claimsErr } = await userClient.auth
    .getClaims(token);
  if (claimsErr || !claimsData?.claims?.sub) {
    return json(401, { error: "Invalid or expired token" });
  }
  const userId = claimsData.claims.sub as string;
  const tokenRole = (claimsData.claims.role as string | undefined) ?? "";
  if (tokenRole !== "authenticated") {
    // Rejects anon JWTs and service-role JWTs.
    return json(401, { error: "Authenticated user required" });
  }

  // ---- Layer 3: verified user must hold the 'admin' role ----
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: roleRow, error: roleErr } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (roleErr) {
    return json(500, { error: "Role lookup failed" });
  }
  if (!roleRow) {
    return json(403, { error: "Admin role required" });
  }

  // ---- All checks passed: run the self-test under the caller's JWT ----
  const { data, error } = await userClient.rpc("acct_run_self_test");
  if (error) return json(500, { error: error.message });

  return json(200, data);
});