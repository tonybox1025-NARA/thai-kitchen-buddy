import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AmountKeypad } from "@/components/AmountKeypad";
import { thb } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  value: number;
  onChange: (n: number) => void;
  title?: string;
  placeholder?: string;
  className?: string;
  /** How to render the value on the field (defaults to Baht). */
  display?: (n: number) => string;
};

/**
 * Amount field for touch POS: shows the value as a button; tapping opens an
 * on-screen keypad instead of the device's OS keyboard. Drop-in replacement for
 * <Input type="number"> wherever a keyboard popping up is clumsy on the SUNMI.
 */
export function KeypadInput({ value, onChange, title = "Enter amount", placeholder, className, display }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const shown = display ?? thb;

  return (
    <>
      <button
        type="button"
        onClick={() => { setDraft(value); setOpen(true); }}
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
          <AmountKeypad value={draft} onChange={setDraft} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => { onChange(draft); setOpen(false); }}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
