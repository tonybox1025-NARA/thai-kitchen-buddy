#!/usr/bin/env node
/**
 * Import Meri POS data → Supabase categories + menus
 *
 * Usage:
 *   1. Add SUPABASE_SERVICE_ROLE_KEY to .env  (Supabase dashboard → Settings → API → service_role)
 *   2. Paste Meri JSON into meri_data.json (array of item objects)
 *   3. node scripts/import-meri.js
 *
 * Expected Meri item shape:
 * {
 *   name_dict:  { TH: "ผัดไทย", EN: "Pad Thai" },
 *   kitchen_title: "ပက်ထိုင်း",          // Myanmar text used as name_my
 *   category_name: "เมนูผัด",             // matched to categories table by name_th
 *   variations: [{ price_money: { amount: 120 } }],
 *   image_url: "https://...",
 *   available: true
 * }
 *
 * If your JSON uses different field names, adjust FIELD_MAP below.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

config({ path: resolve(root, ".env") });

// ── Field name mapping — adjust if Meri uses different keys ──────────────────
const FIELD_MAP = {
  nameTH:       (item) => item.name_dict?.TH ?? item.name_th ?? "",
  nameEN:       (item) => item.name_dict?.EN ?? item.name_en ?? "",
  nameMY:       (item) => item.kitchen_title ?? "",
  categoryName: (item) => item.category_name ?? item.category ?? "",
  price:        (item) => {
    const raw = item.variations?.[0]?.price_money?.amount
      ?? item.price_money?.amount
      ?? item.price
      ?? 0;
    // Meri stores amounts in satang (×100) — divide if > likely max menu price
    return raw > 10000 ? raw / 100 : raw;
  },
  imageUrl:     (item) => item.image_url ?? item.imageUrl ?? null,
  available:    (item) => item.available ?? true,
};

// ── Predefined categories (Thai name → English name, sort) ───────────────────
// These are upserted first; menu items are then matched by category_name_th.
const CATEGORIES = [
  { name_th: "เซตเมนู",             name_en: "Set Menu",           sort:  1 },
  { name_th: "หมูกระทะย่างให้",     name_en: "Grilled Mookata Set", sort:  2 },
  { name_th: "เมนูผัด",             name_en: "Stir-Fried",         sort:  3 },
  { name_th: "เมนูต้ม/ซุป",         name_en: "Soup/Boiled",        sort:  4 },
  { name_th: "เมนูทอด/คั่ว",        name_en: "Fried/Roasted",      sort:  5 },
  { name_th: "เมนูยำ/ตำ",           name_en: "Spicy Salad",        sort:  6 },
  { name_th: "ข้าวผัด/ราดข้าว",     name_en: "Fried Rice",         sort:  7 },
  { name_th: "ข้าวสวย/ข้าวต้ม",     name_en: "Rice/Porridge",      sort:  8 },
  { name_th: "เครื่องดื่ม/ไอศกรีม", name_en: "Drinks/Ice Cream",   sort:  9 },
  { name_th: "แอลกอฮอล์",           name_en: "Alcohol",            sort: 10 },
  { name_th: "LON-CUP",              name_en: "LON-CUP",            sort: 11 },
];

// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL          = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    "❌  Missing env vars.\n" +
    "    SUPABASE_URL              — found in .env\n" +
    "    SUPABASE_SERVICE_ROLE_KEY — add to .env from Supabase dashboard → Settings → API\n"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  // 1. Read Meri data ──────────────────────────────────────────────────────────
  const dataPath = resolve(root, "meri_data.json");
  let items;
  try {
    items = JSON.parse(readFileSync(dataPath, "utf8"));
  } catch (e) {
    console.error("❌  Could not read meri_data.json:", e.message);
    process.exit(1);
  }
  if (!Array.isArray(items) || items.length === 0) {
    console.error("❌  meri_data.json is empty or not an array.");
    process.exit(1);
  }
  console.log(`📂  Loaded ${items.length} items from meri_data.json`);

  // 2. Upsert categories ───────────────────────────────────────────────────────
  console.log("\n🗂   Upserting categories…");
  const { data: catRows, error: catErr } = await supabase
    .from("categories")
    .upsert(
      CATEGORIES.map((c) => ({ ...c, name_my: "" })),
      { onConflict: "name_th" }   // requires unique index on name_th — see note below
    )
    .select("id, name_th");

  if (catErr) {
    // Fallback: upsert may fail if no unique constraint. Insert individually with check.
    console.warn("   upsert conflict strategy failed, falling back to insert-or-select…");
    const inserted = [];
    for (const c of CATEGORIES) {
      const { data: existing } = await supabase
        .from("categories").select("id,name_th").eq("name_th", c.name_th).maybeSingle();
      if (existing) {
        inserted.push(existing);
      } else {
        const { data: created } = await supabase
          .from("categories").insert({ ...c, name_my: "" }).select("id,name_th").single();
        if (created) inserted.push(created);
      }
    }
    catRows?.push(...inserted);
  }

  // Build lookup: Thai name → UUID
  const { data: allCats } = await supabase.from("categories").select("id, name_th");
  const catMap = Object.fromEntries((allCats ?? []).map((c) => [c.name_th, c.id]));
  console.log(`   ✓ ${Object.keys(catMap).length} categories ready`);

  // 3. Build menu rows ─────────────────────────────────────────────────────────
  const unknown = new Set();
  let sort = 1;
  const menuRows = items.map((item) => {
    const catNameTH = FIELD_MAP.categoryName(item);
    const categoryId = catMap[catNameTH] ?? null;
    if (!categoryId && catNameTH) unknown.add(catNameTH);

    return {
      category_id: categoryId,
      name_th:     FIELD_MAP.nameTH(item),
      name_en:     FIELD_MAP.nameEN(item),
      name_my:     FIELD_MAP.nameMY(item),
      price:       FIELD_MAP.price(item),
      image_url:   FIELD_MAP.imageUrl(item),
      available:   FIELD_MAP.available(item),
      sort:        sort++,
    };
  }).filter((row) => row.name_th); // skip rows with no Thai name

  if (unknown.size > 0) {
    console.warn("\n⚠️   These category names from Meri weren't matched (will be NULL):");
    [...unknown].forEach((n) => console.warn(`      • "${n}"`));
    console.warn("    → Add them to CATEGORIES array in this script if needed.\n");
  }

  // 4. Insert menus in batches of 100 ──────────────────────────────────────────
  console.log(`\n🍽   Inserting ${menuRows.length} menu items…`);
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < menuRows.length; i += BATCH) {
    const batch = menuRows.slice(i, i + BATCH);
    const { error } = await supabase.from("menus").insert(batch);
    if (error) {
      console.error(`❌  Batch ${i / BATCH + 1} failed:`, error.message);
      process.exit(1);
    }
    inserted += batch.length;
    process.stdout.write(`   ${inserted}/${menuRows.length}\r`);
  }

  console.log(`\n✅  Done! ${inserted} menus inserted across ${Object.keys(catMap).length} categories.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
