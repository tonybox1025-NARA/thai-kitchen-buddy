import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Delete } from "lucide-react";
import { thb } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  value: number;
  onChange: (n: number) => void;
  title?: string;
  placeholder?: string;
  className?: string;
  /** How to render the value on the field. Defaults to Baht. Use `String` for counts. */
  display?: (n: number) => string;
  /** Allow a decimal point (e.g. VAT %, cost per unit). Default false = whole numbers. */
  decimal?: boolean;
};

/**
 * Number field for touch POS: shows the value as a button; tapping opens an
 * on-screen keypad instead of the device's OS keyboard. Drop-in replacement for
 * <Input type="number"> wherever the keyboard is clumsy on the SUNMI.
 */
export function KeypadInput({ value, onChange, title = "Enter", placeholder, className, display, decimal = false }: Props) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const shown = display ?? thb;

  const openPad = () => {
    setRaw(value ? String(value) : "");
    setOpen(true);
  };

  const press = (d: string) => {
    if (d === ".") {
      if (!decimal || raw.includes(".")) return;
      setRaw(raw === "" ? "0." : raw + ".");
      return;
    }
    let next = (raw + d).replace(/^0+(?=\d)/, "");
    if (decimal) {
      const dec = next.split(".")[1];
      if (dec && dec.length > 2) return; // max 2 decimal places
    }
    setRaw(next.slice(0, 12));
  };
  const back = () => setRaw(raw.slice(0, -1));
  const clear = () => setRaw("");
  const num = raw === "" ? 0 : Number(raw);
  const done = () => { onChange(Number.isFinite(num) ? num : 0); setOpen(false); };

  return (
    <>
      <button
        type="button"
        onClick={openPad}
        className={cn(
          "flex h-11 w-full items-center justify-end rounded-md border bg-background px-3 text-lg font-semibold tabular-nums",
          className,
        )}
      >
        {value > 0 ? shown(value) : <span className="font-normal text-muted-foreground">{placeholder ?? "Tap to enter"}</span>}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
          <div className="h-14 mb-1 flex items-center justify-end px-4 rounded-md border bg-muted/30 text-3xl font-semibold tabular-nums">
            {raw || "0"}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <Button key={d} type="button" variant="outline" size="lg" className="h-14 text-xl font-semibold" onClick={() => press(d)}>{d}</Button>
            ))}
            <Button type="button" variant="outline" size="lg" className="h-14 text-2xl font-semibold" onClick={() => press(decimal ? "." : "00")}>
              {decimal ? "." : "00"}
            </Button>
            <Button type="button" variant="outline" size="lg" className="h-14 text-xl font-semibold" onClick={() => press("0")}>0</Button>
            <Button type="button" variant="outline" size="lg" className="h-14" onClick={back}><Delete className="h-5 w-5" /></Button>
          </div>
          <Button type="button" variant="ghost" size="sm" className="w-full mt-1" onClick={clear}>Clear</Button>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={done}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
