import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PinKeypad } from "./PinKeypad";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onApproved: () => void;
};

export function ManagerPinDialog({ open, onOpenChange, onApproved }: Props) {
  const { requireManagerPin } = useAuth();
  const { t } = useI18n();
  const [err, setErr] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("manager_pin")}</DialogTitle>
        </DialogHeader>
        <PinKeypad
          title=""
          error={err}
          onSubmit={async (pin) => {
            const ok = await requireManagerPin(pin);
            if (ok) {
              setErr(null);
              onOpenChange(false);
              onApproved();
            } else setErr(t("wrong_pin"));
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
