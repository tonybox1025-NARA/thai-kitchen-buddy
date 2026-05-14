import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useQrAlertCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { count: c } = await supabase
        .from("restaurant_tables")
        .select("id", { count: "exact", head: true })
        .eq("has_qr_alert", true);
      if (!cancelled) setCount(c ?? 0);
    };
    load();
    const ch = supabase
      .channel("qr-alert-count")
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_tables" }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, []);

  return count;
}
