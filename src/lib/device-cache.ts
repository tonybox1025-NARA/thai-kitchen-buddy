// Small, versioned device cache for read-mostly POS data. Capacitor keeps
// localStorage on the SUNMI device across navigation and app restarts, so the
// UI can paint immediately while Supabase refreshes in the background.
type CacheEnvelope<T> = { version: number; savedAt: number; value: T };

const VERSION = 1;

export function readDeviceCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as CacheEnvelope<T> | null;
    return parsed?.version === VERSION ? parsed.value : null;
  } catch {
    return null;
  }
}

export function writeDeviceCache<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    const envelope: CacheEnvelope<T> = { version: VERSION, savedAt: Date.now(), value };
    window.localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // A full/disabled cache must never interrupt restaurant operation.
  }
}
