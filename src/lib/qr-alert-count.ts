import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useQrAlertCount(enabled = true) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const { count: c } = await supabase
          .from("restaurant_tables")
          .select("id", { count: "exact", head: true })
          .eq("has_qr_alert", true);
        if (!cancelled) setCount(c ?? 0);
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to load QR alert count", error);
          setCount(0);
        }
      }
    };

    load();
    const ch = supabase
      .channel("qr-alert-count")
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_tables" }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [enabled]);

  return count;
}
