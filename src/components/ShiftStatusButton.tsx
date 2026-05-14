import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Shift = { id: string; business_day: string; status: "open" | "closed" };

export function ShiftStatusButton() {
  const { staff } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [shift, setShift] = useState<Shift | null>(null);
  const [openDlg, setOpenDlg] = useState(false);
  const [opening, setOpening] = useState(0);
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

  const handleClick = () => {
    if (!isOpen) setOpenDlg(true);
    else setPopOpen((v) => !v);
  };

  const submitOpen = async () => {
    if (!staff) return;
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from("shifts").insert({
      business_day: today,
      opened_by: staff.id,
      opening_float: opening,
    });
    setOpenDlg(false);
    setOpening(0);
    load();
  };

  const goReports = () => {
    setPopOpen(false);
    nav({ to: "/reports" });
  };

  return (
    <>
      <Popover open={popOpen} onOpenChange={setPopOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            onClick={handleClick}
            className={`gap-2 border-2 font-semibold ${
              isOpen
                ? "bg-emerald-500/10 text-emerald-700 border-emerald-500 hover:bg-emerald-500/20 dark:text-emerald-400"
                : "bg-destructive/10 text-destructive border-destructive hover:bg-destructive/20"
            }`}
          >
            <ClipboardList className="h-4 w-4" />
            {t("shift")}
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                isOpen ? "bg-emerald-500" : "bg-destructive"
              }`}
            />
          </Button>
        </PopoverTrigger>
        {isOpen && (
          <PopoverContent align="end" className="w-56 p-2">
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("business_day")}: {shift?.business_day}
            </div>
            <Button variant="ghost" className="w-full justify-start" onClick={goReports}>
              {t("x_report")}
            </Button>
            <Button variant="ghost" className="w-full justify-start" onClick={goReports}>
              {t("z_report")}
            </Button>
          </PopoverContent>
        )}
      </Popover>

      <Dialog open={openDlg} onOpenChange={setOpenDlg}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("open_shift")}</DialogTitle>
          </DialogHeader>
          <Label>{t("opening_float")}</Label>
          <Input
            type="number"
            value={opening}
            onChange={(e) => setOpening(Number(e.target.value))}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDlg(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={submitOpen}>{t("confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
