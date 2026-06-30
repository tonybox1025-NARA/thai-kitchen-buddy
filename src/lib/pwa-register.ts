// Guarded service worker registration.
// Registers only in a real production browser on a normal hostname.
// Refuses to register inside Lovable preview / iframe / dev so the
// editor preview is never affected. Supports `?sw=off` kill switch to
// unregister an existing SW (use this if the installed POS misbehaves).
const RECOVERY_RELOAD_KEY = "pos.swRecoveryReloaded.v2";

function isPreviewHost(host: string): boolean {
  return (
    host.startsWith("id-preview--") ||
    host.startsWith("preview--") ||
    host === "lovableproject.com" ||
    host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" ||
    host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" ||
    host.endsWith(".beta.lovable.dev")
  );
}

async function clearCaches() {
  if (!("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
}

async function unregisterAll({ reloadAfter }: { reloadAfter: boolean }) {
  if (!("serviceWorker" in navigator)) return;
  const wasControlled = Boolean(navigator.serviceWorker.controller);
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((r) => r.unregister()));
  await clearCaches();

  if (!reloadAfter || (!wasControlled && regs.length === 0)) return;

  try {
    if (sessionStorage.getItem(RECOVERY_RELOAD_KEY)) return;
    sessionStorage.setItem(RECOVERY_RELOAD_KEY, "1");
  } catch {
    // If storage is blocked, still avoid doing anything risky in production.
    if (!isPreviewHost(window.location.hostname)) return;
  }

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("sw", "off");
  nextUrl.searchParams.set("preview_recovered", String(Date.now()));
  window.location.replace(nextUrl.toString());
}

export function registerPwa() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const url = new URL(window.location.href);
  const killSwitch = url.searchParams.get("sw") === "off";
  const inIframe = window.self !== window.top;
  const isProd = import.meta.env.PROD;
  const host = window.location.hostname;
  const previewHost = isPreviewHost(host);

  if (killSwitch || inIframe || !isProd || previewHost) {
    void unregisterAll({ reloadAfter: killSwitch || previewHost });
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => console.warn("[pwa] SW registration failed", err));
  });
}
