import { supabase } from "@/integrations/supabase/client";
import { writeDeviceCache } from "@/lib/device-cache";

const CATALOG_CACHE_KEY = "lonmoh:pos:catalog:v1";
const IMAGE_CACHE = "lonmoh-pos-menu-images-v1";
const objectUrls = new Map<string, string>();
const resolving = new Map<string, Promise<string>>();
let syncedThisLaunch = false;

export type AssetProgress = { done: number; total: number; stage: "catalog" | "images" };

export async function syncPosAssets(onProgress?: (progress: AssetProgress) => void) {
  if (syncedThisLaunch) {
    onProgress?.({ done: 1, total: 1, stage: "images" });
    return;
  }
  onProgress?.({ done: 0, total: 1, stage: "catalog" });
  const [{ data: menus, error: menuError }, { data: categories, error: categoryError }, { data: settings, error: settingsError }] = await Promise.all([
    supabase.from("menus").select("*").eq("available", true).order("sort"),
    supabase.from("categories").select("*").order("sort"),
    supabase.from("settings").select("vat_enabled,vat_mode,vat_rate,service_fee_rate,rounding_mode,restaurant_name,receipt_logo_url").eq("id", 1).single(),
  ]);
  const error = menuError ?? categoryError ?? settingsError;
  if (error || !menus || !categories || !settings) throw error ?? new Error("Menu sync failed");

  const used = new Set(menus.map((menu) => menu.category_id).filter(Boolean));
  const usedCategories = categories.filter((category) => used.has(category.id));
  writeDeviceCache(CATALOG_CACHE_KEY, { menus, categories: usedCategories, settings });

  const urls = [...new Set(menus.map((menu) => menu.image_url).filter((url): url is string => Boolean(url)))];
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
