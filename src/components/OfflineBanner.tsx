import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/lib/online-status";
import { useI18n } from "@/lib/i18n";

/**
 * Standing warning that the till cannot reach the server.
 *
 * Without it an offline write just does nothing — no spinner, no error — and
 * staff carry on believing the order was saved. Deliberately loud and always in
 * view rather than a toast, because the condition persists until the network
 * comes back.
 */
export function OfflineBanner() {
  const { online } = useOnlineStatus();
  const { lang } = useI18n();

  if (online) return null;

  const th = lang === "th";

  return (
    <div
      role="status"
      aria-live="assertive"
      className="sticky top-14 z-40 flex items-center justify-center gap-2 bg-destructive px-4 py-2 text-center text-sm font-medium text-destructive-foreground"
    >
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>
        {th
          ? "ออฟไลน์ — บันทึกออเดอร์และรับเงินไม่ได้ อย่าเพิ่งรับออเดอร์จนกว่าเน็ตจะกลับมา"
          : "Offline — orders and payments cannot be saved. Wait for the connection to return."}
      </span>
    </div>
  );
}
