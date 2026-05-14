#!/usr/bin/env node
/**
 * Pre-deploy guard for Supabase Edge Functions.
 *
 * Walks every `supabase/functions/<name>/index.ts` (and its transitive
 * relative imports) and verifies that every `./` or `../` import resolves
 * to a file that actually exists on disk. The Supabase deploy bundler
 * fails with a generic "Module not found" error when a relative import is
 * stale or points to a sibling function — this script surfaces the same
 * problem with a clear, actionable message *before* you trigger a deploy.
 *
 * Run from the repo root:
 *   node scripts/check-edge-imports.mjs
 *
 * Exits 0 on success, 1 on any missing module.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';

const FUNCTIONS_DIR = 'supabase/functions';
const errors = [];
const visited = new Set();

/** Resolve a relative import the way Deno does. */
function resolveRelative(from, spec) {
  // Try the literal spec first, then the common TS variants.
  const base = resolve(dirname(from), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    join(base, 'index.ts'),
    join(base, 'index.js'),
  ];
  return candidates.find((p) => existsSync(p) && statSync(p).isFile()) ?? null;
}

/** Walk a single TS/JS file and recurse into its relative imports. */
function walk(filePath, fnName) {
  if (visited.has(filePath)) return;
  visited.add(filePath);

  const src = readFileSync(filePath, 'utf8');
  // Match both `import … from "…"` and dynamic `import("…")`.
  const importRe = /(?:import|export)[^'"`]*['"]([^'"`]+)['"]|import\(\s*['"]([^'"`]+)['"]\s*\)/g;
  let m;
  while ((m = importRe.exec(src)) !== null) {
    const spec = m[1] ?? m[2];
    if (!spec) continue;
    if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
    const resolved = resolveRelative(filePath, spec);
    if (!resolved) {
      errors.push({
        fn: fnName,
        from: relative(process.cwd(), filePath),
        spec,
      });
      continue;
    }
    walk(resolved, fnName);
  }
}

const fnDirs = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
  .map((d) => d.name);

for (const fn of fnDirs) {
  const entry = join(FUNCTIONS_DIR, fn, 'index.ts');
  if (!existsSync(entry)) continue;
  walk(entry, fn);
}

if (errors.length > 0) {
  console.error('\n❌ Edge-function import check failed:\n');
  for (const e of errors) {
    console.error(`  [${e.fn}] ${e.from}`);
    console.error(`    → cannot resolve: "${e.spec}"`);
  }
  console.error(
    `\nFix these stale relative imports before deploying. ` +
      `Shared code goes under supabase/functions/_shared/.\n`,
  );
  process.exit(1);
}

console.log(
  `✅ Edge-function imports OK — verified ${visited.size} files across ${fnDirs.length} functions.`,
);