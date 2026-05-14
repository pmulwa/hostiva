#!/usr/bin/env node
/**
 * i18n coverage report
 * --------------------
 * Scans every page under src/pages/**.tsx for:
 *   - JSX text nodes containing user-visible English strings
 *   - String literals passed to common UI props (placeholder, title, aria-label,
 *     description, label) that are not wrapped in t().
 * Cross-references against src/i18n/locales/en.json. Anything not present in
 * the locale file is flagged as a missing translation candidate.
 *
 * Usage:  node scripts/i18n-coverage.mjs
 *         node scripts/i18n-coverage.mjs --json   (machine-readable)
 *         node scripts/i18n-coverage.mjs --page=src/pages/Search.tsx
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const PAGES_DIR = join(ROOT, "src/pages");
const LOCALE_FILE = join(ROOT, "src/i18n/locales/en.json");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const pageFilter = args.find((a) => a.startsWith("--page="))?.slice("--page=".length);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function flattenLocaleValues(obj, out = new Set()) {
  for (const v of Object.values(obj)) {
    if (typeof v === "string") out.add(v.replace(/\{\{[^}]+\}\}/g, "").trim());
    else if (v && typeof v === "object") flattenLocaleValues(v, out);
  }
  return out;
}

const localeJson = JSON.parse(readFileSync(LOCALE_FILE, "utf8"));
const localeStrings = flattenLocaleValues(localeJson);

// Heuristics: a string is "user-visible English" if it contains at least one
// space or is at least 4 chars and starts with a capital letter, AND is not a
// className / route / import-style token.
const ENGLISH_RX = /^[A-Z][\w'’.,!?:%&()\-\s/]{2,}$/;
const SKIP_RX = /^(text-|bg-|flex|grid|w-|h-|p-|m-|gap-|rounded|border|outline|relative|absolute|hidden|http|\/|\.|#|@)/i;
const KEY_LIKE_RX = /^[a-z][a-zA-Z0-9_.]*$/; // looks like a translation key already

function isTranslationCandidate(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 3) return false;
  if (SKIP_RX.test(trimmed)) return false;
  if (KEY_LIKE_RX.test(trimmed)) return false;
  if (!/[A-Za-z]/.test(trimmed)) return false;
  if (!/\s/.test(trimmed) && !ENGLISH_RX.test(trimmed)) return false;
  return true;
}

// Strip lines that are inside a t("...") call by removing them before scanning.
function stripTranslated(src) {
  return src
    .replace(/\bt\(\s*["'`][^"'`]+["'`]\s*(?:,[^)]*)?\)/g, "__T__")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const JSX_TEXT_RX = />\s*([^<>{}\n]{3,}?)\s*</g;
const PROP_STRING_RX = /\b(?:placeholder|title|aria-label|aria-description|description|label|alt)\s*=\s*["']([^"']{3,})["']/g;
const TOAST_RX = /\b(?:toast(?:\.\w+)?|sonner\.\w+)\(\s*\{[^}]*?(?:title|description)\s*:\s*["'`]([^"'`]{3,})["'`]/g;

function scan(file) {
  const raw = readFileSync(file, "utf8");
  const src = stripTranslated(raw);
  const found = new Map(); // text -> first line
  const addHit = (text, idx) => {
    if (!isTranslationCandidate(text)) return;
    const normalised = text.replace(/\s+/g, " ").trim();
    if (localeStrings.has(normalised)) return;
    if (!found.has(normalised)) {
      const line = src.slice(0, idx).split("\n").length;
      found.set(normalised, line);
    }
  };

  for (const m of src.matchAll(JSX_TEXT_RX)) addHit(m[1], m.index ?? 0);
  for (const m of src.matchAll(PROP_STRING_RX)) addHit(m[1], m.index ?? 0);
  for (const m of src.matchAll(TOAST_RX)) addHit(m[1], m.index ?? 0);

  return [...found.entries()].map(([text, line]) => ({ text, line }));
}

const allPages = walk(PAGES_DIR).filter((p) => !pageFilter || p.endsWith(pageFilter));
const report = [];
for (const page of allPages) {
  const hits = scan(page);
  if (hits.length) report.push({ page: relative(ROOT, page), hits });
}

if (asJson) {
  console.log(JSON.stringify({ totalPages: allPages.length, flagged: report.length, report }, null, 2));
  process.exit(0);
}

const totalHits = report.reduce((n, r) => n + r.hits.length, 0);
console.log(`\n📊 i18n Coverage Report`);
console.log(`   pages scanned : ${allPages.length}`);
console.log(`   pages flagged : ${report.length}`);
console.log(`   strings flagged: ${totalHits}\n`);

for (const { page, hits } of report.sort((a, b) => b.hits.length - a.hits.length)) {
  console.log(`── ${page}  (${hits.length})`);
  for (const { text, line } of hits.slice(0, 25)) {
    const preview = text.length > 80 ? text.slice(0, 77) + "…" : text;
    console.log(`   L${String(line).padStart(4)}  ${preview}`);
  }
  if (hits.length > 25) console.log(`   …and ${hits.length - 25} more`);
}

process.exit(report.length === 0 ? 0 : 0); // report-only; never fails CI