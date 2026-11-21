import { supabase } from "@/integrations/supabase/client";
import { readDeviceCache, writeDeviceCache } from "@/lib/device-cache";

const CATALOG_CACHE_KEY = "lonmoh:pos:catalog:v1";
const IMAGE_CACHE = "lonmoh-pos-menu-images-v1";
const objectUrls = new Map<string, string>();
const resolving = new Map<string, Promise<string>>();
let syncedThisLaunch = false;
let catalogRevision = 0;
let catalogRefreshedAt = 0;
let catalogRefresh: Promise<void> | null = null;
const catalogListeners = new Set<() => void>();
const CATALOG_MAX_AGE_MS = 15_000;

export function subscribePosCatalog(listener: () => void) {
  catalogListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === CATALOG_CACHE_KEY) {
      catalogRevision += 1;
      catalogRefreshedAt = 0;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    catalogListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

// Apply a successful staff pause immediately, including when a catalog request
// started before the pause. That older response must not restore the menu.
export function updateCachedMenuAvailability(id: string, available: boolean) {
  catalogRevision += 1;
  catalogRefreshedAt = 0;
  const catalog = readDeviceCache<{ menus: Array<{ id: string }>; categories: unknown[]; settings: unknown }>(CATALOG_CACHE_KEY);
  if (catalog && !available) {
    writeDeviceCache(CATALOG_CACHE_KEY, { ...catalog, menus: catalog.menus.filter((menu) => menu.id !== id) });
    catalogListeners.forEach((listener) => listener());
  }
}

export function refreshPosCatalog(force = false): Promise<void> {
  if (catalogRefresh) return catalogRefresh;
  if (!force && catalogRefreshedAt && Date.now() - catalogRefreshedAt < CATALOG_MAX_AGE_MS) {
    return Promise.resolve();
  }
  catalogRefresh = (async () => {
    for (;;) {
      const revision = catalogRevision;
      const [{ data: menus, error: menuError }, { data: categories, error: categoryError }, { data: settings, error: settingsError }] = await Promise.all([
        supabase.from("menus").select("*").eq("available", true).order("sort"),
        supabase.from("categories").select("*").order("sort"),
        supabase.from("settings").select("vat_enabled,vat_mode,vat_rate,service_fee_rate,rounding_mode,max_discount_percent,restaurant_name,receipt_logo_url").eq("id", 1).single(),
      ]);
      const error = menuError ?? categoryError ?? settingsError;
      if (error || !menus || !categories || !settings) throw error ?? new Error("Menu sync failed");
      if (revision !== catalogRevision) continue;
      // A featured item with a special price is now charged that price on every
      // channel — customer QR *and* staff POS — so a "Today's Special" sale is
      // consistent. Fetched here so the price rides the offline catalog cache.
      // Mirrors the QR server logic (enabled sections only, non-set menus, the
      // lowest override when an item sits in several sections). Never allowed to
      // block the menu: any failure degrades to normal prices.
      const specialByMenu = new Map<string, number>();
      try {
        // Types for the qr_featured_* tables aren't generated yet, so query
        // through an untyped client (same pattern as settings.tsx / qr-order.ts).
        const fdb = supabase as any;
        const [{ data: sections }, { data: featuredItems }] = await Promise.all([
          fdb.from("qr_featured_sections").select("key").eq("enabled", true),
          fdb.from("qr_featured_items").select("section_key,menu_id,price_override"),
        ]);
        const enabled = new Set((sections ?? []).map((s: { key: string }) => s.key));
        for (const it of (featuredItems ?? []) as Array<{ section_key: string; menu_id: string; price_override: number | null }>) {
          if (it.price_override == null || !enabled.has(it.section_key)) continue;
          const p = Number(it.price_override);
          if (!Number.isFinite(p) || p <= 0) continue;
          const prev = specialByMenu.get(it.menu_id);
          if (prev == null || p < prev) specialByMenu.set(it.menu_id, p);
        }
      } catch {
        // Featured tables unavailable — ship normal prices.
      }
      const pricedMenus = menus.map((menu) => {
        const sp = specialByMenu.get(menu.id);
        const special_price = sp != null && !menu.is_set && sp < Number(menu.price) ? sp : null;
        return { ...menu, special_price };
      });
      const used = new Set(menus.map((menu) => menu.category_id).filter(Boolean));
      writeDeviceCache(CATALOG_CACHE_KEY, { menus: pricedMenus, categories: categories.filter((category) => used.has(category.id)), settings });
      catalogRefreshedAt = Date.now();
      catalogListeners.forEach((listener) => listener());
      return;
    }
  })().finally(() => { catalogRefresh = null; });
  return catalogRefresh;
}

export type AssetProgress = { done: number; total: number; stage: "catalog" | "images" };

type SyncPosAssetOptions = {
  preloadImages?: boolean;
};

export async function syncPosAssets(
  onProgress?: (progress: AssetProgress) => void,
  options: SyncPosAssetOptions = {},
) {
  onProgress?.({ done: 0, total: 1, stage: "catalog" });
  await refreshPosCatalog();
  if (syncedThisLaunch) {
    onProgress?.({ done: 1, total: 1, stage: "images" });
    return;
  }
  const menus = readDeviceCache<{ menus: Array<{ image_url: string | null }> }>(CATALOG_CACHE_KEY)?.menus ?? [];

  const urls = [...new Set(menus.map((menu) => menu.image_url).filter((url): url is string => Boolean(url)))];
  // Browser POS only needs the small catalog snapshot. Preloading every image is
  // reserved for the SUNMI APK, where the local cache makes table switching fast.
  // This keeps Mac/phone web sessions responsive while still giving them menus.
  if (options.preloadImages === false) {
    onProgress?.({ done: 1, total: 1, stage: "images" });
    syncedThisLaunch = true;
    return;
  }
  onProgress?.({ done: 0, total: Math.max(1, urls.length), stage: "images" });
  if (!("caches" in window) || urls.length === 0) {
    onProgress?.({ done: Math.max(1, urls.length), total: Math.max(1, urls.length), stage: "images" });
    syncedThisLaunch = true;
    return;
  }

  const cache = await window.caches.open(IMAGE_CACHE);
  let cursor = 0;
  let done = 0;
  // Bounded concurrency avoids flooding the SUNMI Wi-Fi and UI thread.
  const worker = async () => {
    while (cursor < urls.length) {
      const url = urls[cursor++];
      try {
        const existing = await cache.match(url);
        if (!existing) {
          const response = await fetch(url, { cache: "no-cache" });
          if (response.ok) await cache.put(url, response.clone());
        }
      } catch {
        // A missing photo must not prevent the restaurant from opening.
      } finally {
        done += 1;
        onProgress?.({ done, total: urls.length, stage: "images" });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, () => worker()));
  syncedThisLaunch = true;
}

export function resolveMenuImage(src: string): Promise<string> {
  const ready = objectUrls.get(src);
  if (ready) return Promise.resolve(ready);
  const pending = resolving.get(src);
  if (pending) return pending;
  const task = (async () => {
    try {
      if (!("caches" in window)) return src;
      const response = await (await window.caches.open(IMAGE_CACHE)).match(src);
      if (!response) return src;
      const blob = await response.blob();
      if (!blob.size) return src;
      const localUrl = URL.createObjectURL(blob);
      objectUrls.set(src, localUrl);
      return localUrl;
    } catch {
      return src;
    } finally {
      resolving.delete(src);
    }
  })();
  resolving.set(src, task);
  return task;
}
