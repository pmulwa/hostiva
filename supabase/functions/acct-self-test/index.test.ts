import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

/**
 * End-to-end accounting cycle test.
 *
 * Hits the deployed `acct-self-test` edge function which delegates to the
 * persistent SQL function `public.acct_run_self_test`. That function:
 *   1. Creates a sample property + booking (status='pending')
 *   2. Asserts no journal entry exists yet
 *   3. Transitions to 'completed' and asserts a balanced entry is auto-posted
 *   4. Re-cycles status and asserts no double-post occurs
 *   5. Asserts the unique index physically blocks duplicate posts
 *   6. Asserts the entry persists across booking edits
 *   7. Asserts entry_date resyncs when check_out_date changes
 *   8. Asserts the balance trigger rejects unbalanced lines
 *   9. Cleans up all fixtures
 */

Deno.test("acct-self-test: rejects unauthenticated callers", async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/acct-self-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
  });
  const body = await res.text();
  assertEquals(res.status, 401, `expected 401, got ${res.status}: ${body}`);
});

Deno.test("acct-self-test: rejects non-admin authenticated callers", async () => {
  // Anonymous JWT (apikey) is not a real user session → expect 401 from getUser.
  const res = await fetch(`${SUPABASE_URL}/functions/v1/acct-self-test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
  });
  const body = await res.text();
  assert(res.status === 401 || res.status === 403,
    `expected 401/403, got ${res.status}: ${body}`);
});

/**
 * Full-cycle test. Requires env vars `ACCT_TEST_ADMIN_EMAIL` and
 * `ACCT_TEST_ADMIN_PASSWORD` for an existing admin account. Skipped
 * gracefully when they are not set so CI does not fail in fresh envs.
 */
Deno.test("acct-self-test: full accounting cycle passes for admin", async () => {
  const email = Deno.env.get("ACCT_TEST_ADMIN_EMAIL");
  const password = Deno.env.get("ACCT_TEST_ADMIN_PASSWORD");
  if (!email || !password) {
    console.warn("Skipping: ACCT_TEST_ADMIN_EMAIL / _PASSWORD not set");
    return;
  }

  // Sign in as admin via the auth REST endpoint.
  const signin = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY },
      body: JSON.stringify({ email, password }),
    },
  );
  const tokens = await signin.json();
  assertEquals(signin.status, 200, `signin failed: ${JSON.stringify(tokens)}`);
  const accessToken = tokens.access_token as string;
  assert(accessToken, "missing access token");

  // Invoke the self-test.
  const res = await fetch(`${SUPABASE_URL}/functions/v1/acct-self-test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const report = await res.json();
  assertEquals(res.status, 200, `self-test failed: ${JSON.stringify(report)}`);

  // Assert every individual check passed.
  assert(typeof report.passed === "number", "missing passed counter");
  assert(typeof report.failed === "number", "missing failed counter");
  const checks: Array<{ check: string; ok: boolean; detail: string | null }> =
    report.checks ?? [];
  const failed = checks.filter((c) => !c.ok);
  assertEquals(
    report.failed,
    0,
    `${report.failed} check(s) failed:\n${failed
      .map((c) => ` - ${c.check}: ${c.detail}`)
      .join("\n")}`,
  );

  // Make sure all expected checks ran.
  const names = new Set(checks.map((c) => c.check));
  for (const expected of [
    "pending booking does not auto-post",
    "completion creates journal entry",
    "debits equal credits",
    "double-post prevented on re-completion",
    "unique-index blocks duplicate auto-post",
    "journal entry persists across booking edits",
    "entry_date resyncs to new check-out",
    "balance trigger rejects unbalanced line",
  ]) {
    assert(names.has(expected), `missing check "${expected}"`);
  }
});