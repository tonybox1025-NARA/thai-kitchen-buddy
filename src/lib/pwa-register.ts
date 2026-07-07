// Guarded service worker registration.
// Registers only in a real production browser on a normal hostname.
// Refuses to register inside Lovable preview / iframe / dev so the
// editor preview is never affected. In preview/iframe/dev, actively
// unregisters any leftover SW and clears Cache Storage — reloading
// exactly once per session so the fresh page is served from network.
// Supports `?sw=off` kill switch for manual recovery in production.
const RECOVERY_RELOAD_KEY = "pos.swRecoveryReloaded.v3";

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

async function clearCaches(): Promise<number> {
  if (!("caches" in window)) return 0;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    return keys.length;
  } catch {
    return 0;
  }
}

function markReloaded(): boolean {
  try {
    if (sessionStorage.getItem(RECOVERY_RELOAD_KEY)) return false;
    sessionStorage.setItem(RECOVERY_RELOAD_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

function reloadOnce() {
  if (!markReloaded()) return;
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("sw", "off");
  nextUrl.searchParams.set("preview_recovered", String(Date.now()));
  window.location.replace(nextUrl.toString());
}

async function purgeAndRecover({ reloadAfter }: { reloadAfter: boolean }) {
  if (!("serviceWorker" in navigator)) {
    const cleared = await clearCaches();
    if (reloadAfter && cleared > 0) reloadOnce();
    return;
  }

  const wasControlled = Boolean(navigator.serviceWorker.controller);
  let regs: readonly ServiceWorkerRegistration[] = [];
  try {
    regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    // ignore — still try to clear caches below
  }
  const clearedCount = await clearCaches();

  const somethingChanged = wasControlled || regs.length > 0 || clearedCount > 0;
  if (reloadAfter && somethingChanged) reloadOnce();
}

export function registerPwa() {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  const killSwitch = url.searchParams.get("sw") === "off";
  const inIframe = window.self !== window.top;
  const isProd = import.meta.env.PROD;
  const host = window.location.hostname;
  const previewHost = isPreviewHost(host);
  const untrustedContext = killSwitch || inIframe || !isProd || previewHost;

  if (untrustedContext) {
    // Auto-invalidate any leftover SW + Cache Storage and reload once so
    // the preview tab never serves stale HTML/JS from a prior deploy.
    void purgeAndRecover({ reloadAfter: true });
    return;
  }

  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => console.warn("[pwa] SW registration failed", err));
  });
}
