import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source.replace(/^import .*;\n/gm, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const edgeSource = compile(read("supabase/functions/sync-manager-catalog/index.ts"));
const sourceMenu = (id, extra = {}) => ({
  id, name_th: id, name_en: id, name_my: "", category: "Food", selling_price: 90,
  food_cost: 25, image_url: "https://example.test/menu.jpg", sort_order: 1,
  is_active: true, available_pos: true, available_qr: true, ...extra,
});

function edgeHarness(initial, { beforeWrite, updateError } = {}) {
  const rows = structuredClone(initial);
  const writes = [];
  let handler;
  let started = false;
  const db = { from(table) {
    let action = "select", payload, filterId;
    const query = {
      select() { return query; },
      update(value) { action = "update"; payload = value; return query; },
      insert(value) { action = "insert"; payload = value; return query; },
      upsert(value) { action = "upsert"; payload = value; return query; },
      eq(key, value) { assert.equal(key, "id"); filterId = value; return query; },
      single() { return query; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        if (action === "select") return { data: table === "menus" ? structuredClone(rows) : [], error: null };
        if (!started) { started = true; beforeWrite?.(rows); }
        writes.push({ table, action, payload: structuredClone(payload) });
        if (table !== "menus") return { error: null };
        if (action === "update") {
          if (updateError) return { error: { message: updateError } };
          const row = rows.find((item) => item.id === filterId);
          if (!row) return { error: { message: "Expected exactly one menu" } };
          assert.ok(!Object.hasOwn(payload, "available"), "publish must never update staff POS availability");
          assert.ok(!Object.hasOwn(payload, "available_qr"), "publish must never update staff QR availability");
          Object.assign(row, structuredClone(payload));
          return { data: { id: row.id }, error: null };
        }
        assert.equal(action, "insert", "only new menus may be inserted; never upsert existing menus");
        rows.push(...structuredClone(payload));
        return { error: null };
      }).then(resolve, reject); },
    };
    return query;
  } };
  vm.runInNewContext(edgeSource, {
    createClient: () => db,
    Deno: { env: { get: (key) => key === "SUPABASE_SECRET_KEYS" ? JSON.stringify({ default: "sb_secret_test" }) : "test" }, serve: (fn) => { handler = fn; } },
    Response, Request, Headers, crypto: webcrypto, fetch: () => { throw new Error("No network in regression tests"); },
    console: { error() {} },
  });
  return { rows, writes, async publish(menus, execute = true) {
    const response = await handler(new Request("https://example.test/sync", {
      method: "POST", headers: { "X-Catalog-Sync-Key": "test", "Content-Type": "application/json" },
      body: JSON.stringify({ execute, catalog: { menus } }),
    }));
    return { status: response.status, body: await response.json() };
  } };
}

// Run the actual Edge Function against an isolated in-memory DB, including the
// gap between its SELECT snapshot and later writes (the original race).
for (const available of [true, false]) for (const availableQr of [true, false]) {
  const menu = sourceMenu("manager", { available_pos: !available, available_qr: !availableQr });
  const h = edgeHarness([{ id: "pos", manager_menu_id: "manager", name_th: "Old name", available, available_qr: availableQr }]);
  const result = await h.publish([menu]);
  assert.equal(result.status, 200);
  assert.equal(h.rows[0].available, available);
  assert.equal(h.rows[0].available_qr, availableQr);
  assert.equal(h.rows[0].name_th, "manager");
  assert.equal(h.rows[0].price, 90);
  assert.equal(h.rows[0].cost, 25);
  assert.equal(result.body.menuMappings[0].posId, "pos");
  await h.publish([menu]);
  assert.equal(h.rows.length, 1, "repeat publication preserves the menu ID");
}
for (const staffChoice of [false, true]) {
  const h = edgeHarness([{ id: "pos", manager_menu_id: "manager", name_th: "manager", available: !staffChoice, available_qr: !staffChoice }], {
    beforeWrite(rows) { rows[0].available = staffChoice; rows[0].available_qr = staffChoice; },
  });
  assert.equal((await h.publish([sourceMenu("manager")])).status, 200);
  assert.equal(h.rows[0].available, staffChoice, "a concurrent staff toggle wins");
  assert.equal(h.rows[0].available_qr, staffChoice);
}
{
  const h = edgeHarness([]);
  assert.equal((await h.publish([sourceMenu("new"), sourceMenu("child", { is_set_child: true }), sourceMenu("hidden", { available_pos: false })])).status, 200);
  assert.equal(h.rows.length, 2);
  assert.equal(h.rows.find((row) => row.manager_menu_id === "new").available, true);
  assert.equal(h.rows.find((row) => row.manager_menu_id === "child").available, false);
  assert.equal(h.rows.find((row) => row.manager_menu_id === "child").available_qr, false);
}
for (const mapping of ["pos_menu_id", "name"]) {
  const h = edgeHarness([{ id: "legacy", name_th: "manager", available: false, available_qr: false }]);
  const menu = sourceMenu("manager", mapping === "pos_menu_id" ? { pos_menu_id: "legacy" } : {});
  assert.equal((await h.publish([menu])).status, 200);
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].available, false);
}
{
  const h = edgeHarness([{ id: "pos", manager_menu_id: "manager", name_th: "manager", available: false }]);
  assert.equal((await h.publish([sourceMenu("manager")], false)).status, 200);
  assert.equal(h.writes.length, 0, "preview cannot write");
}
for (const updateError of ["write denied", null]) {
  const h = edgeHarness([{ id: "pos", manager_menu_id: "manager", name_th: "manager", available: false }], {
    updateError,
    beforeWrite: updateError ? undefined : (rows) => rows.splice(0),
  });
  assert.equal((await h.publish([sourceMenu("manager")])).status, 400, "failure or missing target cannot report success or recreate an open menu");
}

// Execute the actual cache/sync module: one launch, multiple refreshes, a pause
// during a pending network response, offline failure and successful recovery.
const exports = {};
let cache = null;
let queries = 0;
let fail = false;
let release;
let gate = null;
const live = [{ id: "pos", category_id: "food", available: true, image_url: null }];
const listeners = new Map();
let now = 1_000_000;
const queryDb = { from(table) {
  const query = {
    select: () => query, eq: () => query, order: () => query, single: () => query,
    then(resolve, reject) { return Promise.resolve().then(async () => {
      queries++;
      const data = table === "menus" ? structuredClone(live.filter((row) => row.available)) : table === "categories" ? [{ id: "food" }] : table === "qr_featured_sections" || table === "qr_featured_items" ? [] : { restaurant_name: "Test" };
      if (table === "menus" && gate) { const pending = gate; gate = null; await pending; }
      if (fail) return { data: null, error: new Error("offline") };
      return { data, error: null };
    }).then(resolve, reject); },
  };
  return query;
} };
vm.runInNewContext(compile(read("src/lib/pos-assets.ts")), {
  exports, supabase: queryDb, readDeviceCache: () => structuredClone(cache),
  writeDeviceCache: (_key, value) => { cache = structuredClone(value); },
  window: { addEventListener: (event, cb) => listeners.set(event, cb), removeEventListener: (event) => listeners.delete(event) },
  Date: { now: () => now }, console, URL,
});
let notifications = 0;
const unsubscribe = exports.subscribePosCatalog(() => notifications++);
const first = exports.refreshPosCatalog(true);
assert.equal(exports.refreshPosCatalog(true), first, "concurrent refreshes share one request");
await first;
assert.equal(cache.menus.length, 1);
// 5 queries per refresh: menus + categories + settings, plus the two featured
// tables that carry "Today's Special" prices into the offline catalog.
assert.equal(queries, 5);
await exports.refreshPosCatalog();
assert.equal(queries, 5, "table transitions within the freshness window use cache");
gate = new Promise((resolve) => { release = resolve; });
const pending = exports.refreshPosCatalog(true);
await new Promise((resolve) => setImmediate(resolve));
live[0].available = false;
exports.updateCachedMenuAvailability("pos", false);
assert.equal(cache.menus.length, 0, "staff pause updates the local cache immediately");
release();
await pending;
assert.equal(cache.menus.length, 0, "a pre-pause response cannot resurrect a menu");
fail = true;
await assert.rejects(exports.refreshPosCatalog(true), /offline/);
assert.equal(cache.menus.length, 0, "failed refresh preserves the latest paused state");
fail = false;
live[0].available = true;
await exports.refreshPosCatalog(true);
assert.equal(cache.menus.length, 1, "refresh can recover and reopen a staff-enabled menu");
await exports.syncPosAssets(undefined, { preloadImages: false });
live[0].available = false;
now += 30_000;
await exports.syncPosAssets(undefined, { preloadImages: false });
assert.equal(cache.menus.length, 0, "startup image guard must not freeze catalog data");
assert.ok(notifications >= 5);
unsubscribe();
assert.equal(listeners.size, 0);

const order = read("src/routes/_app/order.$orderId.tsx");
for (const text of ["subscribePosCatalog(applyCatalog)", '"focus", onResume', '"online", onResume', '"visibilitychange", onResume', "30_000"]) {
  assert.ok(order.includes(text), `order view must keep menu availability fresh: ${text}`);
}
console.log("Menu publish availability: staff flags, concurrent toggles, stable IDs, new rows, preview/failure and cache refresh checks passed.");
