import { useEffect, useState } from "react";

/**
 * Whether the till can actually reach the server right now.
 *
 * `navigator.onLine` alone is not enough: it only reports that a network
 * interface exists, so a tablet sitting on restaurant Wi-Fi with a dead uplink
 * still reports "online" while every write fails. This pairs that instant signal
 * with a periodic reach check against Supabase.
 *
 * Any HTTP response counts as reachable — even 401. The question is whether the
 * server answers at all, not whether this particular request was authorised.
 */

const PROBE_INTERVAL_MS = 20_000;
const PROBE_TIMEOUT_MS = 6_000;

/**
 * Latest known reachability, readable outside React.
 *
 * Event handlers need this synchronously to refuse a write before starting it.
 * A request made while offline does not fail cleanly — supabase-js waits on its
 * auth-token lock and the promise never settles, so the caller's error branch
 * never runs and the button appears dead. Checking first avoids that entirely.
 */
let lastKnownOnline = true;

export function isOffline(): boolean {
  return !lastKnownOnline;
}

function supabaseOrigin(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

async function canReachServer(): Promise<boolean> {
  const origin = supabaseOrigin();
  if (!origin) return true; // Nothing to probe — don't cry wolf.

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(`${origin}/auth/v1/health`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function useOnlineStatus(): { online: boolean; checking: boolean } {
  const [online, setOnline] = useState(true);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const apply = (value: boolean) => {
      lastKnownOnline = value;
      if (!cancelled) setOnline(value);
    };

    const probe = async () => {
      // A browser that already knows it is offline needs no round trip.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        apply(false);
        return;
      }
      if (!cancelled) setChecking(true);
      const reachable = await canReachServer();
      if (cancelled) return;
      apply(reachable);
      setChecking(false);
    };

    // React instantly to the OS signal, then confirm with a real request.
    const onOffline = () => apply(false);
    const onOnline = () => void probe();
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    void probe();
    const timer = window.setInterval(() => void probe(), PROBE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return { online, checking };
}
