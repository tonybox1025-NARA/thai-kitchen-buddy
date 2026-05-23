import { useState } from "react";
import { Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { thb } from "@/lib/format";
import { SETS, SET_C_DRINKS, type SetDef, type SetConfig, type SetItem } from "@/lib/set-menu";

interface SetMenuDialogProps {
  setDef: SetDef | null;
  onClose: () => void;
  onConfirm: (config: SetConfig) => void;
}

export function SetMenuDialog({ setDef, onClose, onConfirm }: SetMenuDialogProps) {
  const { lang, t } = useI18n();
  const [main, setMain] = useState<SetItem | null>(null);
  const [sides, setSides] = useState<SetItem[]>([]);
  const [drink, setDrink] = useState<SetItem | null>(null);
  const [rice, setRice] = useState<"rice" | "porridge">("rice");

  const isOpen = !!setDef;

  const toggleSide = (item: SetItem) => {
    setSides((prev) => {
      const exists = prev.some((s) => s.th === item.th);
      if (exists) return prev.filter((s) => s.th !== item.th);
      if (prev.length >= 2) return prev; // already 2 selected, ignore
      return [...prev, item];
    });
  };

  const isSideSelected = (item: SetItem) => sides.some((s) => s.th === item.th);
  const isSideDisabled = (item: SetItem) => sides.length >= 2 && !isSideSelected(item);

  const canConfirm =
    !!main &&
    sides.length === 2 &&
    (!setDef?.hasDrink || !!drink);

  const handleConfirm = () => {
    if (!setDef || !main || sides.length !== 2) return;
    if (setDef.hasDrink && !drink) return;
    onConfirm({
      set_id: setDef.id,
      main,
      sides: sides as [SetItem, SetItem],
      drink: drink ?? undefined,
      rice,
    });
  };

  const primary = (item: SetItem) => lang === "th" ? item.th : item.en;
  const secondary = (item: SetItem) => lang === "th" ? item.en : item.th;

  const mainDoneCount = main ? 1 : 0;
  const sidesDoneCount = sides.length;

  return (
    <Dialog key={setDef?.id} open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden flex flex-col max-h-[90vh]">
        <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
          <DialogTitle className="flex items-baseline gap-2">
            <span className="text-xl font-black text-amber-700 dark:text-amber-300">
              {setDef ? (lang === "th" ? setDef.name_th : setDef.name_en) : ""}
            </span>
            <span className="text-lg font-bold text-primary">{setDef ? thb(setDef.price) : ""}</span>
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("set_includes")}
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-5">
          {/* Main Dish */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm">{t("set_main_dish")}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${mainDoneCount === 1 ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" : "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"}`}>
                {mainDoneCount === 1 ? `✓ 1/1` : t("set_select_1")}
              </span>
            </div>
            <div className="space-y-2">
              {setDef?.mains.map((item) => {
                const selected = main?.th === item.th;
                return (
                  <button
                    key={item.th}
                    onClick={() => setMain(item)}
                    className={`w-full flex items-center gap-3 rounded-lg border-2 px-3 py-2.5 text-left transition-all ${selected ? "border-primary bg-primary/5 dark:bg-primary/10" : "border-border hover:border-primary/50"}`}
                  >
                    <span className={`flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${selected ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                      {selected && <span className="w-2 h-2 rounded-full bg-white" />}
                    </span>
                    <span>
                      <span className="font-medium text-sm">{primary(item)}</span>
                      <span className="text-xs text-muted-foreground ml-1.5">{secondary(item)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Side Dishes */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm">{t("set_side_dish")}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${sidesDoneCount === 2 ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" : "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"}`}>
                {sidesDoneCount === 2 ? `✓ 2/2` : `${sidesDoneCount}/2`}
              </span>
            </div>
            <div className="space-y-2">
              {setDef?.sides.map((item) => {
                const selected = isSideSelected(item);
                const disabled = isSideDisabled(item);
                return (
                  <button
                    key={item.th}
                    onClick={() => !disabled && toggleSide(item)}
                    disabled={disabled}
                    className={`w-full flex items-center gap-3 rounded-lg border-2 px-3 py-2.5 text-left transition-all ${selected ? "border-primary bg-primary/5 dark:bg-primary/10" : "border-border hover:border-primary/50"} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                  >
                    <span className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center ${selected ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                      {selected && <Check className="w-3 h-3 text-white" />}
                    </span>
                    <span>
                      <span className="font-medium text-sm">{primary(item)}</span>
                      <span className="text-xs text-muted-foreground ml-1.5">{secondary(item)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Free Drink (SET C only) */}
          {setDef?.hasDrink && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm">{t("set_free_drink")}</h3>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${drink ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}>
                  {drink ? "✓ 1/1" : t("set_select_1")}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {SET_C_DRINKS.map((item) => {
                  const selected = drink?.th === item.th;
                  return (
                    <button
                      key={item.th}
                      onClick={() => setDrink(item)}
                      className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2.5 text-left transition-all ${selected ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20" : "border-border hover:border-amber-400"}`}
                    >
                      <span className={`flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${selected ? "border-amber-500 bg-amber-500" : "border-muted-foreground"}`}>
                        {selected && <span className="w-2 h-2 rounded-full bg-white" />}
                      </span>
                      <span>
                        <span className={`font-medium text-xs ${selected ? "text-amber-700 dark:text-amber-300" : ""}`}>{primary(item)}</span>
                        <span className="block text-xs text-muted-foreground">{secondary(item)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Rice selection */}
          <section>
            <h3 className="font-semibold text-sm mb-2">{t("set_rice")}</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setRice("rice")}
                className={`flex-1 rounded-lg border-2 py-2.5 text-center font-medium text-sm transition-all ${rice === "rice" ? "border-primary bg-primary/5 dark:bg-primary/10" : "border-border hover:border-primary/50"}`}
              >
                {t("set_steamed_rice")}
              </button>
              <button
                onClick={() => setRice("porridge")}
                className={`flex-1 rounded-lg border-2 py-2.5 text-center font-medium text-sm transition-all ${rice === "porridge" ? "border-primary bg-primary/5 dark:bg-primary/10" : "border-border hover:border-primary/50"}`}
              >
                {t("set_porridge")}
              </button>
            </div>
          </section>

          {/* Summary box */}
          {(main || sides.length > 0) && (
            <div className="bg-muted/30 rounded-lg p-3 space-y-1 text-sm">
              <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-1.5">{t("set_summary")}</p>
              {main && <p>🍽️ {main.th}</p>}
              {sides.map((s, idx) => <p key={idx}>🥗 {s.th}</p>)}
              {drink && <p>🥤 {drink.th} <span className="text-amber-600 font-semibold text-xs">FREE</span></p>}
              <p>🍚 {rice === "rice" ? (lang === "th" ? "ข้าวสวย" : "Steamed Rice") : (lang === "th" ? "โจ๊ก" : "Porridge")}</p>
            </div>
          )}
        </div>

        <DialogFooter className="px-5 py-4 border-t shrink-0 flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">{t("cancel")}</Button>
          <Button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="flex-1 bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-600 dark:hover:bg-amber-700"
          >
            {lang === "th" ? "เพิ่มในออเดอร์" : "Add to order"} · {setDef ? thb(setDef.price) : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
