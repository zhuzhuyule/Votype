#!/usr/bin/env node
/**
 * i18n guard for CI.
 *
 * Fails (exit 1) when:
 *   1. a locale is missing keys that exist in the reference locale (en)
 *   2. source code calls t("...") with a key that is not defined in en
 *   3. source code contains NEW hardcoded CJK text (compared to the baseline)
 *
 * The hardcoded-text rule uses a baseline ratchet (scripts/i18n-hardcoded-baseline.json)
 * so we can enforce "no new violations" while the legacy strings are migrated to i18n.
 * Shrink the baseline as you migrate; regenerate with:
 *
 *     node scripts/i18n-check.mjs --write-baseline
 *
 * Escape hatch for legitimate CJK literals (regex ranges, test data, ...):
 * add `i18n-ignore` anywhere on the same line.
 *
 * Usage:
 *   node scripts/i18n-check.mjs                 # check (CI mode)
 *   node scripts/i18n-check.mjs --strict        # ignore baseline, fail on any CJK
 *   node scripts/i18n-check.mjs --write-baseline
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const LOCALES = path.join(SRC, "i18n", "locales");
const BASELINE = path.join(ROOT, "scripts", "i18n-hardcoded-baseline.json");
const REF = "en";

// Locales that are maintained in lockstep with the reference and MUST stay in
// sync. Community locales may lag behind (tracked as warnings) and fall back to
// en at runtime via i18next.
const REQUIRED = (process.env.I18N_REQUIRED_LOCALES || "en,zh")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const args = new Set(process.argv.slice(2));
const STRICT = args.has("--strict");
const WRITE_BASELINE = args.has("--write-baseline");

const CJK = /[\u4e00-\u9fff]/;
const IGNORE = /i18n-ignore/;

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const errors = [];
const warnings = [];

// ---- load locales -------------------------------------------------------
const langDirs = fs
  .readdirSync(LOCALES)
  .filter((d) => fs.statSync(path.join(LOCALES, d)).isDirectory());

const locales = {};
for (const l of langDirs) {
  const file = path.join(LOCALES, l, "translation.json");
  try {
    locales[l] = flatten(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (e) {
    errors.push(`[locale] ${l}/translation.json 解析失败: ${e.message}`);
  }
}

if (!locales[REF]) {
  console.error(`reference locale "${REF}" not found under ${LOCALES}`);
  process.exit(2);
}
const refKeys = new Set(Object.keys(locales[REF]));

// ---- check 1: locale key parity ----------------------------------------
// Optional floor so translation coverage cannot silently rot. Unset by
// default: community locales are expected to lag, we only want the number
// to be visible and to fail when someone explicitly opts in.
const MIN_COVERAGE = Number(process.env.I18N_MIN_COVERAGE ?? "0");
const coverage = [];

for (const l of Object.keys(locales).sort()) {
  if (l === REF) continue;
  const keys = new Set(Object.keys(locales[l]));
  const missing = [...refKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !refKeys.has(k));
  const pct = ((refKeys.size - missing.length) / refKeys.size) * 100;

  // A key that exists but is an empty string renders as nothing at all, which
  // is worse than falling back to English — treat it as missing.
  const blank = [...refKeys].filter(
    (k) => keys.has(k) && (locales[l][k] === "" || locales[l][k] == null),
  );

  coverage.push({ l, pct, missing: missing.length, extra: extra.length, blank: blank.length });

  if (missing.length) {
    const msg = `${l}: 缺 ${missing.length}/${refKeys.size} 个 key (${pct.toFixed(1)}% 覆盖, 示例: ${missing.slice(0, 3).join(", ")})`;
    if (REQUIRED.includes(l)) errors.push(`[locale] ${msg}`);
    else warnings.push(`[locale] ${msg}`);
  }
  if (blank.length) {
    const msg = `${l}: 有 ${blank.length} 个 key 值为空（示例: ${blank.slice(0, 3).join(", ")}）`;
    if (REQUIRED.includes(l)) errors.push(`[locale] ${msg}`);
    else warnings.push(`[locale] ${msg}`);
  }
  if (extra.length) {
    warnings.push(`[locale] ${l}: 有 ${extra.length} 个 en 中不存在的多余 key（示例: ${extra.slice(0, 3).join(", ")}）`);
  }
  if (MIN_COVERAGE > 0 && pct < MIN_COVERAGE) {
    errors.push(
      `[locale] ${l}: 覆盖率 ${pct.toFixed(1)}% 低于阈值 ${MIN_COVERAGE}%`,
    );
  }
}

// ---- check 2 & 3: scan source -------------------------------------------
const T_CALL = /\bt\(\s*["'`]([A-Za-z0-9_.\-]+)["'`]/g;
const hardcoded = {}; // relPath -> [lines]

for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file);
  if (rel.startsWith(path.join("src", "i18n"))) continue;
  const raw = fs.readFileSync(file, "utf8");

  // check 2: undefined t() keys
  let m;
  T_CALL.lastIndex = 0;
  while ((m = T_CALL.exec(raw))) {
    if (!refKeys.has(m[1])) {
      errors.push(`[code] ${rel}: 使用了未定义的 key "${m[1]}"`);
    }
  }

  // check 3: hardcoded CJK (strip comments first, keeping line numbers intact)
  const rawLines = raw.split("\n");
  const blockless = raw.replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, " "));
  const codeLines = blockless.split("\n").map((ln) => ln.replace(/\/\/.*$/, ""));

  const hits = [];
  codeLines.forEach((ln, i) => {
    if (!CJK.test(ln)) return;
    if (IGNORE.test(rawLines[i])) return;
    hits.push(`${i + 1}: ${rawLines[i].trim().slice(0, 100)}`);
  });
  if (hits.length) hardcoded[rel] = hits;
}

// ---- hardcoded ratchet ---------------------------------------------------
let baseline = {};
if (!WRITE_BASELINE && !STRICT && fs.existsSync(BASELINE)) {
  baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
}

const newHardcoded = {};
for (const [rel, hits] of Object.entries(hardcoded)) {
  const allowed = baseline[rel] ?? 0;
  if (hits.length > allowed) {
    newHardcoded[rel] = hits.slice(allowed);
  }
}

if (WRITE_BASELINE) {
  const out = {};
  for (const [rel, hits] of Object.entries(hardcoded)) out[rel] = hits.length;
  fs.writeFileSync(BASELINE, JSON.stringify(out, null, 2) + "\n");
  console.log(`baseline written: ${Object.keys(out).length} files, ${Object.values(out).reduce((a, b) => a + b, 0)} lines -> ${path.relative(ROOT, BASELINE)}`);
  process.exit(0);
}

if (STRICT) {
  for (const [rel, hits] of Object.entries(hardcoded)) {
    for (const h of hits) errors.push(`[hardcoded] ${rel}:${h}`);
  }
} else {
  for (const [rel, hits] of Object.entries(newHardcoded)) {
    for (const h of hits) errors.push(`[hardcoded:new] ${rel}:${h}`);
  }
}

// ---- report --------------------------------------------------------------
const totalHardcoded = Object.values(hardcoded).reduce((a, b) => a + b.length, 0);
console.log(`locales: ${langDirs.length} (ref=${REF}, ${refKeys.size} keys)`);
console.log(`hardcoded CJK: ${Object.keys(hardcoded).length} files / ${totalHardcoded} lines` +
  (STRICT ? " (strict)" : ` (baseline allows ${Object.values(baseline).reduce((a, b) => a + b, 0)})`));

// Coverage table — deliberately printed even when everything passes, because
// a partially translated locale silently falls back to English per key and
// nothing else in the build surfaces that.
if (coverage.length) {
  const bar = (pct) => {
    const filled = Math.round(pct / 5);
    return "█".repeat(filled) + "░".repeat(20 - filled);
  };
  console.log("");
  console.log("translation coverage vs " + REF + ":");
  for (const c of coverage.sort((a, b) => b.pct - a.pct)) {
    console.log(
      `  ${c.l.padEnd(4)} ${bar(c.pct)} ${c.pct.toFixed(1).padStart(5)}%` +
        `  ${c.missing ? `缺 ${c.missing}` : "完整"}`,
    );
  }
}

for (const w of warnings) console.log(`warn  ${w}`);

if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors.slice(0, 60)) console.error(`  ${e}`);
  if (errors.length > 60) console.error(`  ... and ${errors.length - 60} more`);
  process.exit(1);
}
console.log("\ni18n check passed.");
