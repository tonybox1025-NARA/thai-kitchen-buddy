#!/usr/bin/env node
/**
 * Generate INSERT SQL from meri_data.json → supabase/seed.sql
 *
 * Usage:
 *   node scripts/generate-seed-sql.js
 *
 * Then paste supabase/seed.sql into the Supabase SQL editor.
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// ── Categories (Thai name without emoji → our DB name_th) ────────────────────
// Meri stores category names with emoji prefix e.g. "🍚 ข้าวสวย/ข้าวต้ม"
// We strip emoji/symbols and match the Thai text portion.
const CATEGORIES = [
  { name_th: "เซตเมนู",             name_en: "Set Menu",            sort:  1 },
  { name_th: "หมูกระทะย่างให้",     name_en: "Grilled Mookata Set", sort:  2 },
  { name_th: "เมนูผัด",             name_en: "Stir-Fried",          sort:  3 },
  { name_th: "เมนูต้ม/ซุป",         name_en: "Soup/Boiled",         sort:  4, aliases: ["เมนูต้ม / ซุป"] },
  { name_th: "เมนูทอด/คั่ว",        name_en: "Fried/Roasted",       sort:  5, aliases: ["เมนูทอด / คั่ว"] },
  { name_th: "เมนูยำ/ตำ",           name_en: "Spicy Salad",         sort:  6, aliases: ["เมนูยำ / ตำ"] },
  { name_th: "ข้าวผัด/ราดข้าว",     name_en: "Fried Rice",          sort:  7 },
  { name_th: "ข้าวสวย/ข้าวต้ม",     name_en: "Rice/Porridge",       sort:  8 },
  { name_th: "เครื่องดื่ม/ไอศกรีม", name_en: "Drinks/Ice Cream",    sort:  9, aliases: ["เครื่องดื่ม / ไอศกรีม"] },
  { name_th: "แอลกอฮอล์",           name_en: "Alcohol",             sort: 10 },
  { name_th: "LON-CUP",              name_en: "LON-CUP",             sort: 11 },
];

// Strip leading emoji / symbols / spaces to get the Thai text
function stripEmoji(str) {
  return (str ?? "")
    .replace(/^[\p{Emoji}\p{So}\p{Sk}\s🍚🍳🍲🍖🥗🧊🍺📦🐷]+/gu, "")
    .trim();
}

// Extract Myanmar characters from a mixed-language string
// Myanmar Unicode block: U+1000–U+109F
function extractMyanmar(str) {
  const matches = (str ?? "").match(/[က-႟ꩠ-ꩿ]+[\sက-႟ꩠ-ꩿ]*/g);
  return matches ? matches.join(" ").trim() : "";
}

// Build lookup: Thai name (+ aliases) → our canonical name_th
const catLookup = new Map();
CATEGORIES.forEach((c) => {
  catLookup.set(c.name_th, c.name_th);
  (c.aliases ?? []).forEach((a) => catLookup.set(a, c.name_th));
});

function resolveCategoryNameTH(item) {
  const meriCatName = item.categories?.[0]?.name_dict?.TH ?? "";
  const stripped = stripEmoji(meriCatName);
  if (catLookup.has(stripped)) return catLookup.get(stripped);
  // Partial match fallback
  for (const [key, val] of catLookup.entries()) {
    if (stripped.includes(key) || key.includes(stripped)) return val;
  }
  return stripped || null;
}

// ── SQL helpers ───────────────────────────────────────────────────────────────

// Encode any string as a PostgreSQL Unicode escape literal (pure ASCII output).
// Non-ASCII chars → \XXXX hex escapes; single quotes and backslashes escaped.
// Result: U&'\0E02\0E49...' — safe through any clipboard or text editor.
function esc(s) {
  if (s == null) return "NULL";
  const str = String(s);
  let hasNonAscii = false;
  let body = "";
  for (const char of str) {
    const code = char.codePointAt(0);
    if (code > 127) {
      hasNonAscii = true;
      if (code <= 0xffff) {
        body += `\\${code.toString(16).toUpperCase().padStart(4, "0")}`;
      } else {
        body += `\\+${code.toString(16).toUpperCase().padStart(6, "0")}`;
      }
    } else if (char === "'") {
      body += "''";
    } else if (char === "\\") {
      body += "\\\\";
    } else {
      body += char;
    }
  }
  if (!hasNonAscii) return `'${body}'`;
  return `U&'${body}'`;
}

const escBool = (b) => (b ? "true" : "false");

function categorySubquery(nameTH) {
  if (!nameTH) return "NULL";
  return `(SELECT id FROM public.categories WHERE name_th = ${esc(nameTH)} LIMIT 1)`;
}

// ── Load data ─────────────────────────────────────────────────────────────────
const dataPath = resolve(root, "meri_data.json");
let raw;
try {
  raw = JSON.parse(readFileSync(dataPath, "utf8"));
} catch (e) {
  console.error("❌  Could not read meri_data.json:", e.message);
  process.exit(1);
}

// Support both array and { item_data: [...] } wrapper
const items = Array.isArray(raw) ? raw : (raw.item_data ?? []);
if (items.length === 0) {
  console.error("❌  No items found in meri_data.json.");
  process.exit(1);
}
console.log(`📂  Loaded ${items.length} items`);

// Skip archived/deleted items
const active = items.filter((i) => !i.is_archived && !i.is_deleted);
console.log(`   ${active.length} active items (${items.length - active.length} archived/deleted skipped)`);

// Warn about unmatched categories
const knownCats = new Set(CATEGORIES.map((c) => c.name_th));
const unknown = new Set();
active.forEach((item) => {
  const cat = resolveCategoryNameTH(item);
  if (cat && !knownCats.has(cat)) unknown.add(cat);
});
if (unknown.size > 0) {
  console.warn("\n⚠️   Unmatched categories (will get NULL category_id):");
  [...unknown].forEach((n) => console.warn(`      • "${n}"`));
  console.warn("    → Add to CATEGORIES array in this script if needed.\n");
}

// ── Build SQL ─────────────────────────────────────────────────────────────────
const lines = [];

lines.push(`-- ============================================================`);
lines.push(`-- Meri POS seed data  (generated ${new Date().toISOString()})`);
lines.push(`-- ${active.length} menu items, ${CATEGORIES.length} categories`);
lines.push(`-- Paste into: https://supabase.com/dashboard/project/sbjzbphdjfpjvjbzjuzk/sql/new`);
lines.push(`-- ============================================================`);
lines.push(``);

// Categories
lines.push(`-- ── Categories ──────────────────────────────────────────────`);
lines.push(`truncate public.menus, public.categories restart identity cascade;`);
lines.push(``);
lines.push(`insert into public.categories (name_th, name_en, name_my, sort) values`);
lines.push(
  CATEGORIES.map((c, i) =>
    `  (${esc(c.name_th)}, ${esc(c.name_en)}, '', ${c.sort})` +
    (i < CATEGORIES.length - 1 ? "," : ";")
  ).join("\n")
);
lines.push(``);

// Menus
lines.push(`-- ── Menus (${active.length} items) ──────────────────────────────────────`);
lines.push(`insert into public.menus`);
lines.push(`  (category_id, name_th, name_en, name_my, price, image_url, available, sort)`);
lines.push(`values`);

const menuLines = active.map((item, i) => {
  const nameTH    = item.name_dict?.TH ?? item.name_th ?? "";
  if (!nameTH) return null;
  const nameEN    = item.name_dict?.EN ?? item.name_en ?? "";
  const nameMY    = extractMyanmar(item.kitchen_title ?? "");
  const catNameTH = resolveCategoryNameTH(item);
  const priceRaw  = item.variations?.[0]?.price_money?.amount ?? item.price ?? 0;
  const price     = parseFloat(priceRaw).toFixed(2);
  const imageUrl  = item.image_url ?? null;
  const available = item.available ?? true;
  const isLast    = i === active.length - 1;

  return (
    `  (${categorySubquery(catNameTH)},\n` +
    `   ${esc(nameTH)}, ${esc(nameEN)}, ${esc(nameMY)},\n` +
    `   ${price}, ${esc(imageUrl)}, ${escBool(available)}, ${i + 1})` +
    (isLast ? ";" : ",")
  );
}).filter(Boolean);

lines.push(menuLines.join("\n"));
lines.push(``);

// ── Write output ──────────────────────────────────────────────────────────────
const outPath = resolve(root, "supabase", "seed.sql");
writeFileSync(outPath, lines.join("\n"), "utf8");

console.log(`\n✅  supabase/seed.sql 생성 완료 (${active.length} menus, ${CATEGORIES.length} categories)`);
console.log(`\n   다음 단계: Supabase SQL 에디터에 붙여넣기`);
console.log(`   https://supabase.com/dashboard/project/sbjzbphdjfpjvjbzjuzk/sql/new`);
