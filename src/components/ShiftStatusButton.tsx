import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Shift = { id: string; business_day: string; status: "open" | "closed" };

export function ShiftStatusButton() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [shift, setShift] = useState<Shift | null>(null);
  const [popOpen, setPopOpen] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("shifts")
      .select("id,business_day,status")
      .eq("status", "open")
      .maybeSingle();
    setShift((data as Shift) ?? null);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("shift-status")
      .on("postgres_changes", { event: "*", schema: "public", table: "shifts" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const isOpen = !!shift;

  const goReports = () => {
    setPopOpen(false);
    nav({ to: "/reports" });
  };

  return (
    <Popover open={popOpen} onOpenChange={setPopOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={`gap-2 border-2 font-semibold ${
            isOpen
              ? "bg-emerald-500/10 text-emerald-700 border-emerald-500 hover:bg-emerald-500/20 dark:text-emerald-400"
              : "bg-muted text-muted-foreground border-muted-foreground/30 hover:bg-muted/80"
          }`}
        >
          <ClipboardList className="h-4 w-4" />
          {t("shift")}
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              isOpen ? "bg-emerald-500" : "bg-muted-foreground/50"
            }`}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-2">
        {isOpen ? (
          <>
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("business_day")}: {shift?.business_day}
            </div>
            <Button variant="ghost" className="w-full justify-start" onClick={goReports}>
              {t("x_report")}
            </Button>
            <Button variant="ghost" className="w-full justify-start" onClick={goReports}>
              {t("z_report")}
            </Button>
          </>
        ) : (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            {t("no_open_shift")}. {t("starting_cash_help")}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
