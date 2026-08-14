import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { WifiOff, Loader2 } from "lucide-react";

// Health-pings Supabase so we detect the common "Wi-Fi is up but the internet is
// dead" case (navigator.onLine stays true then). Shows a badge only when down, so
// staff know why orders/receipts are slow instead of staring at a spinner.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;

async function ping(): Promise<boolean> {
  if (!SUPABASE_URL) return true;
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 6000);
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/health`, { signal: ac.signal, cache: "no-store" });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(to);
  }
}

export function ConnectionStatus() {
  const { t } = useI18n();
  const [online, setOnline] = useState(true);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) { if (alive) setOnline(false); return; }
      if (alive) setChecking(true);
      const ok = await ping();
      if (!alive) return;
      setOnline(ok);
      setChecking(false);
    };
    void check();
    const iv = setInterval(() => void check(), 20000);
    const onOnline = () => void check();
    const onOffline = () => { if (alive) setOnline(false); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      alive = false;
      clearInterval(iv);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (online) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 text-destructive px-2.5 py-1 text-xs font-semibold">
      {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WifiOff className="h-3.5 w-3.5" />}
      {checking ? t("net_reconnecting") : t("net_offline")}
    </span>
  );
}
